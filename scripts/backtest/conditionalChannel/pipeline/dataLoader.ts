// scripts/backtest/conditionalChannel/pipeline/dataLoader.ts
// ---------------------------------------------------------------------------
// KR-size 파이프라인 — 처리된 데이터 파일 로더.
//
// Python ingest(download→apply_corporate_actions→build_month_end_universe→
// build_manifest) 가 생성한 파일들을 읽어 시뮬레이터 호환 형태로 변환한다.
//
// 데이터 위치: scripts/backtest/data/conditionalChannel/kr/processed/
//   · securities/{CODE}.json          — split-adjusted OHLCV
//   · month_end/{YYYY-MM}.json        — 월말 스냅샷
//   · corporate_actions.json          — 기업행위 이벤트
//   · securities_meta.json            — 종목 메타
//   · manifest.json                   — 매니페스트 + 게이트 결과
//
// 규칙: `any` 금지, `console.*` 금지, 외부 I/O는 node:fs/promises만 사용.
// ---------------------------------------------------------------------------

import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  MonthlyGroupFlags,
  Market,
  LedgerCurrency,
  IsoDate,
} from '../../../../types/backtestConditionalChannel';
import type {
  DataPipelineManifest,
  KrSecurityBars,
  KrSizeDataset,
  MonthEndSecurityRecord,
  MonthEndSnapshot,
  SecurityJsonFile,
  SecurityMeta,
  SplitEventRaw,
} from './types';

// ===========================================================================
// 1. 로더 설정
// ===========================================================================

const MARKET: Market = 'KR';
const CURRENCY: LedgerCurrency = 'KRW';

export interface DataLoaderOptions {
  /** 처리된 데이터 루트 경로 (기본: scripts/backtest/data/conditionalChannel/kr/processed/) */
  processedDir?: string;
  /** 로드할 종목 코드 목록 (미지정 시 전체 로드) */
  codes?: readonly string[];
  /** 시작 날짜 이전 바는 제외 */
  fromDate?: IsoDate;
  /** 종료 날짜 이후 바는 제외 */
  toDate?: IsoDate;
}

export class DataLoadError extends Error {
  constructor(
    public readonly cause: 'MANIFEST_MISSING' | 'PRELOCK_GATE_FAIL' | 'FILE_READ_ERROR' | 'PARSE_ERROR',
    message: string
  ) {
    super(message);
    this.name = 'DataLoadError';
  }
}

// ===========================================================================
// 2. 파일 읽기 유틸
// ===========================================================================

async function readJsonFile<T>(path: string): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (e) {
    throw new DataLoadError('FILE_READ_ERROR', `파일 읽기 실패: ${path} — ${String(e)}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new DataLoadError('PARSE_ERROR', `JSON 파싱 실패: ${path} — ${String(e)}`);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ===========================================================================
// 3. 매니페스트 검사
// ===========================================================================

/**
 * 매니페스트를 읽고 prelock 허용 여부를 확인한다.
 * FAIL이면 DataLoadError를 throw한다.
 */
export async function checkManifest(processedDir: string): Promise<DataPipelineManifest> {
  const manifestPath = join(processedDir, 'manifest.json');
  if (!(await fileExists(manifestPath))) {
    throw new DataLoadError(
      'MANIFEST_MISSING',
      `manifest.json 없음: ${manifestPath}\n` +
        '인제스트 파이프라인을 먼저 실행하세요:\n' +
        '  python scripts/backtest/conditionalChannel/ingest/download_marcap.py\n' +
        '  python scripts/backtest/conditionalChannel/ingest/apply_corporate_actions.py\n' +
        '  python scripts/backtest/conditionalChannel/ingest/build_month_end_universe.py\n' +
        '  python scripts/backtest/conditionalChannel/ingest/build_manifest.py'
    );
  }

  const manifest = await readJsonFile<DataPipelineManifest>(manifestPath);

  if (manifest.dataGateVerdict.prelock === 'FAIL') {
    const failedGates = manifest.gates
      .filter((g) => !g.passed)
      .map((g) => g.gate)
      .join(', ');
    throw new DataLoadError(
      'PRELOCK_GATE_FAIL',
      `데이터 게이트 FAIL — prelock 실행 불가.\n실패 게이트: ${failedGates}\n` +
        '해결 후 build_manifest.py를 재실행하세요.'
    );
  }

  return manifest;
}

// ===========================================================================
// 4. 종목 데이터 로드
// ===========================================================================

function securityJsonToKrBars(
  sec: SecurityJsonFile,
  fromDate: IsoDate | undefined,
  toDate: IsoDate | undefined
): KrSecurityBars {
  const bars = sec.bars.filter((b) => {
    if (fromDate && b.date < fromDate) return false;
    if (toDate && b.date > toDate) return false;
    return true;
  });

  return {
    securityId: sec.code,
    symbol: sec.code,
    name: sec.name,
    market: MARKET,
    currency: CURRENCY,
    dates:      bars.map((b) => b.date),
    open:       bars.map((b) => b.adj_open),
    high:       bars.map((b) => b.adj_high),
    low:        bars.map((b) => b.adj_low),
    close:      bars.map((b) => b.adj_close),
    volume:     bars.map((b) => b.adj_volume),
    adjFactors: bars.map((b) => b.adj_factor),
  };
}

async function loadSecurities(
  securitiesDir: string,
  codes: readonly string[] | undefined,
  fromDate: IsoDate | undefined,
  toDate: IsoDate | undefined
): Promise<Map<string, KrSecurityBars>> {
  const map = new Map<string, KrSecurityBars>();

  let targetCodes: string[];
  if (codes && codes.length > 0) {
    targetCodes = [...codes];
  } else {
    const files = await readdir(securitiesDir);
    targetCodes = files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  }

  const batchSize = 32;
  for (let start = 0; start < targetCodes.length; start += batchSize) {
    const batch = targetCodes.slice(start, start + batchSize);
    const loaded = await Promise.all(batch.map(async (code) => {
      const path = join(securitiesDir, `${code}.json`);
      if (!(await fileExists(path))) return null;
      const sec = await readJsonFile<SecurityJsonFile>(path);
      return { code, bars: securityJsonToKrBars(sec, fromDate, toDate) };
    }));
    for (const item of loaded) {
      if (item !== null && item.bars.dates.length > 0) map.set(item.code, item.bars);
    }
  }

  return map;
}

// ===========================================================================
// 5. 월말 스냅샷 → MonthlyGroupFlags[] 변환
// ===========================================================================

function snapshotToMonthlyFlags(snapshot: MonthEndSnapshot): MonthlyGroupFlags[] {
  return snapshot.securities
    .filter((r): r is MonthEndSecurityRecord & { investable: true } => r.investable)
    .map((r): MonthlyGroupFlags => ({
      securityId: r.code,
      market: MARKET,
      asOfMonthEnd: snapshot.month_end,
      effectiveMonth: snapshot.effective_month,
      investable: true,
      marketCap: r.marketcap,
      marketCapPercentile: r.percentile,
      large: r.large,
      sectorCode: null,             // KR-size에는 업종 없음
      sectorRankByMarketCap: null,
      sectorInvestableCount: null,
      leader: false,                // KR-size에는 leader 없음
      group: r.unclassifiable ? 'B' : (r.group ?? 'B'), // unclassifiable=true면 group 무의미
      unclassifiable: r.unclassifiable,
      tieBreakNote: '대형주: 시총 DESC, 코드 ASC tie-break. leader 제외(KR-size). unclassifiable=true면 A/B 분석 제외.',
    }));
}

async function loadMonthlyFlags(
  monthEndDir: string,
  fromDate: IsoDate | undefined,
  toDate: IsoDate | undefined
): Promise<Map<string, MonthlyGroupFlags[]>> {
  const map = new Map<string, MonthlyGroupFlags[]>();

  const files = await readdir(monthEndDir);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  for (const f of jsonFiles) {
    const ym = f.replace('.json', ''); // 'YYYY-MM'
    // 날짜 필터 (월 단위 비교)
    if (fromDate && ym < fromDate.slice(0, 7)) continue;
    if (toDate && ym > toDate.slice(0, 7)) continue;

    const snapshot = await readJsonFile<MonthEndSnapshot>(join(monthEndDir, f));
    const flags = snapshotToMonthlyFlags(snapshot);
    map.set(ym, flags);
  }

  return map;
}

// ===========================================================================
// 6. 메인 로더
// ===========================================================================

const DEFAULT_PROCESSED_DIR =
  'scripts/backtest/data/conditionalChannel/kr/processed/';

/**
 * KR-size 파이프라인 전체 데이터를 로드한다.
 * 매니페스트 게이트를 먼저 확인하고 실패하면 DataLoadError를 throw한다.
 */
export async function loadKrSizeDataset(
  options: DataLoaderOptions = {}
): Promise<KrSizeDataset> {
  const processedDir = options.processedDir ?? DEFAULT_PROCESSED_DIR;

  // 1. 매니페스트 확인
  const manifest = await checkManifest(processedDir);

  // 2. 기업행위 로드
  const caPath = join(processedDir, 'corporate_actions.json');
  const corporateActions: SplitEventRaw[] = (await fileExists(caPath))
    ? await readJsonFile<SplitEventRaw[]>(caPath)
    : [];

  // 3. 종목 데이터 로드
  const securitiesDir = join(processedDir, 'securities');
  const securitiesByCode = await loadSecurities(
    securitiesDir,
    options.codes,
    options.fromDate,
    options.toDate
  );

  // 4. 월말 스냅샷 → MonthlyGroupFlags 로드
  const monthEndDir = join(processedDir, 'month_end');
  const monthlyFlags = await loadMonthlyFlags(
    monthEndDir,
    options.fromDate,
    options.toDate
  );

  return {
    market: MARKET,
    currency: CURRENCY,
    securitiesByCode,
    monthlyFlags,
    corporateActions,
    manifest,
    loadedAt: new Date().toISOString(),
  };
}

// ===========================================================================
// 7. 데이터 정합성 빠른 확인 (로드 후 선택적 실행)
// ===========================================================================

export interface DataIntegrityCheck {
  securitiesLoaded: number;
  monthsLoaded: number;
  corpActionsLoaded: number;
  missingSecurities: string[];   // monthlyFlags에 있는데 securitiesByCode에 없는 코드
  emptyBarSecurities: string[];  // bars 배열이 비어있는 코드
  passed: boolean;
  note: string;
}

export function checkDataIntegrity(dataset: KrSizeDataset): DataIntegrityCheck {
  const allCodesInFlags = new Set<string>();
  for (const flags of dataset.monthlyFlags.values()) {
    for (const f of flags) allCodesInFlags.add(f.securityId);
  }

  const missingSecurities = [...allCodesInFlags].filter(
    (code) => !dataset.securitiesByCode.has(code)
  );

  const emptyBarSecurities = [...dataset.securitiesByCode.entries()]
    .filter(([, bars]) => bars.dates.length === 0)
    .map(([code]) => code);

  const passed = missingSecurities.length === 0 && emptyBarSecurities.length === 0;

  return {
    securitiesLoaded: dataset.securitiesByCode.size,
    monthsLoaded: dataset.monthlyFlags.size,
    corpActionsLoaded: dataset.corporateActions.length,
    missingSecurities: missingSecurities.slice(0, 20),
    emptyBarSecurities: emptyBarSecurities.slice(0, 20),
    passed,
    note: passed
      ? `${dataset.securitiesByCode.size}개 종목, ${dataset.monthlyFlags.size}개 월 로드 완료`
      : `종목 불일치: ${missingSecurities.length}건, 빈 bars: ${emptyBarSecurities.length}건`,
  };
}
