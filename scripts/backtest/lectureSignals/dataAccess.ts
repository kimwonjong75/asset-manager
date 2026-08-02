// scripts/backtest/lectureSignals/dataAccess.ts
// ---------------------------------------------------------------------------
// 데이터 접근층: 분할조정 바(+원천 amount, per-bar 시장) 로드, PIT 월말 유니버스,
// 기업행위일 집합, 미분류 168종목 제외 확인, KOSPI 레짐 시계열.
//
// 재사용: conditionalChannel/pipeline/dataLoader.loadKrSizeDataset로 월말 PIT 플래그
//   (백분위·대형)와 매니페스트 prelock 게이트 확인을 재사용한다(§17). 바는 amount가
//   필요해 별도 reader로 직접 읽는다(기존 로더가 amount·market을 노출하지 않음).
//
// 규칙: `any`·`console.*`(드라이버 아님) 금지. 외부 I/O는 fs만.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadKrSizeDataset } from '../conditionalChannel/pipeline/dataLoader';
import type { MonthlyGroupFlags } from '../../../types/backtestConditionalChannel';
import type { Market, RegimeVariantCode, SecurityBars } from './configTypes';
import { CONST } from './configTypes';
import { fetchIndexSeries } from './kospiIndex';
import { smaInclusive, smaSlopeIsNegative } from './features';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_DIR = path.resolve(
  __dirname,
  '..',
  'data',
  'conditionalChannel',
  'kr',
  'processed'
);

interface RawSecurityFile {
  code: string;
  name: string;
  bars: Array<{
    date: string;
    amount: number;
    market: string;
    close: number; // 원시(무조정) 종가 — S5_APP_RUNTIME_RAW 전용
    volume: number; // 원시(무조정) 거래량 — S5_APP_RUNTIME_RAW 전용
    adj_open: number;
    adj_high: number;
    adj_low: number;
    adj_close: number;
    adj_volume: number;
  }>;
}

/** per-month 투자가능 종목 특성(백분위·대형). */
export interface PitRecord {
  percentile: number;
  large: boolean;
}
export type PitUniverse = Map<string, Map<string, PitRecord>>; // effectiveMonth -> code -> rec

export interface LectureDataset {
  bars: Map<string, SecurityBars>;
  pit: PitUniverse;
  investableUnion: Set<string>;
  corpActionDates: Set<string>; // `code|date`
  unresolvedCodes: Set<string>;
  manifestPrelock: string;
}

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf-8')) as T;
}

function normMarket(m: string): Market | null {
  if (m === 'KOSPI') return 'KOSPI';
  if (m === 'KOSDAQ') return 'KOSDAQ';
  return null; // KONEX/ETF 등은 투자가능 유니버스에서 이미 제외됨
}

/** 단일 종목 JSON → SecurityBars(전 기간, warmup 포함). */
function loadOneSecurity(code: string): SecurityBars | null {
  const p = path.join(PROCESSED_DIR, 'securities', `${code}.json`);
  let raw: RawSecurityFile;
  try {
    raw = readJson<RawSecurityFile>(p);
  } catch {
    return null;
  }
  const dates: string[] = [];
  const adjOpen: number[] = [];
  const adjHigh: number[] = [];
  const adjLow: number[] = [];
  const adjClose: number[] = [];
  const adjVolume: number[] = [];
  const amount: number[] = [];
  const market: string[] = [];
  const rawClose: number[] = [];
  const rawVolume: number[] = [];
  const dateIndex = new Map<string, number>();
  for (const b of raw.bars) {
    dateIndex.set(b.date, dates.length);
    dates.push(b.date);
    adjOpen.push(b.adj_open);
    adjHigh.push(b.adj_high);
    adjLow.push(b.adj_low);
    adjClose.push(b.adj_close);
    adjVolume.push(b.adj_volume);
    amount.push(b.amount);
    market.push(b.market);
    rawClose.push(b.close);
    rawVolume.push(b.volume);
  }
  if (dates.length === 0) return null;
  return {
    code,
    name: raw.name,
    dates,
    adjOpen,
    adjHigh,
    adjLow,
    adjClose,
    adjVolume,
    amount,
    market,
    close: rawClose,
    volume: rawVolume,
    dateIndex,
  };
}

/**
 * 월말 플래그 Map(as-of월 키) → PIT 유니버스(**effectiveMonth 키**) 변환 + 투자가능 유니언.
 *
 * ⚠ 룩어헤드 방지(계획서 §4.1·§15-3): `loadKrSizeDataset`의 `monthlyFlags` Map은 파일명
 * =as-of월(month_end, 예 "2014-01")로 키가 잡혀 있다. 그러나 그 스냅샷은 **다음 달**
 * (`effectiveMonth`="2014-02")부터 유효하다. `pitLookup`이 `date.slice(0,7)`으로 조회하므로
 * pit 키를 as-of월로 두면 2월 조회가 2월말(as-of "2014-02") 스냅샷을 집어 1개월 룩어헤드가 된다.
 * 반드시 각 레코드의 `effectiveMonth`로 키를 잡는다(레코드에 이미 채워져 있음).
 * (같은 effectiveMonth에 두 스냅샷이 겹치는 일은 정상 데이터에선 없어야 하며, 겹치면 뒤가 덮어씀.)
 */
export function buildPitUniverse(
  monthlyFlags: ReadonlyMap<string, readonly MonthlyGroupFlags[]>
): { pit: PitUniverse; investableUnion: Set<string> } {
  const pit: PitUniverse = new Map();
  const investableUnion = new Set<string>();
  for (const [, flags] of monthlyFlags.entries()) {
    for (const f of flags) {
      // f는 investable=true만(로더 필터). unclassifiable 제외.
      if (f.unclassifiable) continue;
      const eff = f.effectiveMonth; // ← as-of월이 아니라 실제 적용월(다음 달)
      let inner = pit.get(eff);
      if (!inner) {
        inner = new Map<string, PitRecord>();
        pit.set(eff, inner);
      }
      inner.set(f.securityId, {
        percentile: f.marketCapPercentile ?? 0,
        large: f.large,
      });
      investableUnion.add(f.securityId);
    }
  }
  return { pit, investableUnion };
}

/**
 * 개발+검증 전체 데이터셋 로드. loadKrSizeDataset로 PIT 플래그·prelock 게이트를 확인하고,
 * 투자가능 유니버스 종목의 바만 직접 읽는다(미분류 168종목 제외).
 */
export async function loadLectureDataset(): Promise<LectureDataset> {
  // 1) PIT 월말 유니버스 + prelock 게이트(최소 종목만 로드해 검증)
  const ds = await loadKrSizeDataset({
    codes: ['005930'],
    fromDate: '2010-01-01',
    toDate: '2022-12-31',
  });
  const manifestPrelock = ds.manifest.dataGateVerdict.prelock;

  const { pit, investableUnion } = buildPitUniverse(ds.monthlyFlags);

  // 2) 미분류 168종목(제외 유지 확인)
  const unresolvedRaw = readJson<Array<string | { code: string }>>(
    path.join(PROCESSED_DIR, 'unresolved_corporate_action_codes.json')
  );
  const unresolvedCodes = new Set<string>(
    unresolvedRaw.map((u) => (typeof u === 'string' ? u : u.code))
  );
  // 방어적 제외: 유니버스에서 미분류 종목 제거
  for (const c of unresolvedCodes) investableUnion.delete(c);

  // 3) 기업행위일 집합(S3 제외)
  interface CorpAction {
    code: string;
    event_date: string;
  }
  const corpRaw = readJson<CorpAction[]>(path.join(PROCESSED_DIR, 'corporate_actions.json'));
  const corpActionDates = new Set<string>();
  for (const c of corpRaw) corpActionDates.add(`${c.code}|${c.event_date}`);

  // 4) 바 로드(투자가능 유니버스만)
  const bars = new Map<string, SecurityBars>();
  for (const code of investableUnion) {
    const b = loadOneSecurity(code);
    if (b) bars.set(code, b);
  }

  return {
    bars,
    pit,
    investableUnion,
    corpActionDates,
    unresolvedCodes,
    manifestPrelock,
  };
}

/** effectiveMonth 조회 헬퍼: 날짜 D의 유효 유니버스 레코드. */
export function pitLookup(pit: PitUniverse, code: string, date: string): PitRecord | null {
  const eff = date.slice(0, 7);
  return pit.get(eff)?.get(code) ?? null;
}

// ===========================================================================
// KOSPI 레짐 시계열
// ===========================================================================

export interface RegimeSeries {
  symbol: string;
  dates: string[];
  close: number[];
  /** 변형별 위험여부(true=위험, null=판정불가 warmup). */
  risk: Record<RegimeVariantCode, (boolean | null)[]>;
  levelAtOrBefore(date: string): number | null;
  riskAtOrBefore(variant: RegimeVariantCode, date: string): boolean | null;
}

/** KOSPI(^KS11) 종가로 4개 레짐 변형 시계열을 만든다. */
export async function loadRegimeSeries(symbol = '^KS11'): Promise<RegimeSeries> {
  const s = await fetchIndexSeries(symbol, '2009-01-01', '2022-12-31');
  if (!s.ok) throw new Error(`레짐 지수 로드 실패(${symbol}): ${s.error}`);
  const { dates, close } = s;
  const n = dates.length;
  const level: (boolean | null)[] = new Array(n);
  const slope: (boolean | null)[] = new Array(n);
  const combined: (boolean | null)[] = new Array(n);
  const level200: (boolean | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const ma150 = smaInclusive(close, i, CONST.ma150);
    const ma200 = smaInclusive(close, i, CONST.ma200);
    const slopeNeg = smaSlopeIsNegative(close, i, CONST.ma150, CONST.slopeLag);
    const lvl = ma150 === null ? null : close[i] < ma150;
    const lvl200 = ma200 === null ? null : close[i] < ma200;
    level[i] = lvl;
    slope[i] = slopeNeg;
    level200[i] = lvl200;
    // COMBINED = LEVEL 또는 SLOPE. 둘 다 판정불가면 null, 하나만 가능하면 그 값 기준.
    if (lvl === null && slopeNeg === null) combined[i] = null;
    else combined[i] = Boolean(lvl) || Boolean(slopeNeg);
  }
  const dateIdx = new Map<string, number>();
  for (let i = 0; i < n; i++) dateIdx.set(dates[i], i);
  const idxAtOrBefore = (date: string): number => {
    let lo = 0;
    let hi = n - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= date) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };
  const risk: Record<RegimeVariantCode, (boolean | null)[]> = {
    KR150_LEVEL: level,
    KR150_SLOPE: slope,
    KR150_COMBINED: combined,
    KR200_LEVEL: level200,
  };
  return {
    symbol,
    dates,
    close,
    risk,
    levelAtOrBefore(date: string): number | null {
      const i = idxAtOrBefore(date);
      return i < 0 ? null : close[i];
    },
    riskAtOrBefore(variant: RegimeVariantCode, date: string): boolean | null {
      const i = idxAtOrBefore(date);
      return i < 0 ? null : risk[variant][i];
    },
  };
}
