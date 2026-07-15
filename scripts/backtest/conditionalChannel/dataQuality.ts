// scripts/backtest/conditionalChannel/dataQuality.ts
// ---------------------------------------------------------------------------
// 조건부 돌파 채널 가설(PROMPT_3 §3) Phase 0 — 데이터 가능성 감사(정적 능력 감사).
//
// 목적: 수익률·성과를 계산하기 전에, PROMPT_3 §3의 8개 강제 중단(하드스톱) 조건을
//       현재 저장소에서 도달 가능한 데이터 소스의 "능력"에 대해 평가한다.
//       하나라도 met=true면 게이트 FAIL → 1차 확증 백테스트를 실행하지 않고
//       DATA_GAP 보고서만 작성한다(§3·§16).
//
// ⚠ 이것은 "정적 능력 감사"다:
//   이 샌드박스 환경에서는 라이브 외부 데이터 소스를 프로빙할 수 없으므로,
//   "확인된 소스와 그 능력"을 아래 STATIC_SOURCE_AUDIT에 명시적·문서적으로 하드코딩한다.
//   가짜 가용성을 지어내지 않는다 — 실제로 이 저장소에서 도달 가능한 것만 AVAILABLE로 둔다.
//   새 데이터 소스(예: CRSP/Compustat, KRX 벤더)를 배선하면 이 파일을 갱신하고 재실행한다.
//
// 근거(직접 조사):
//   · scripts/backtest/sectorRotation/lib/yahooData.ts 는 Yahoo v8 /chart 만 호출한다.
//     → 분할/배당 조정 OHLCV(adjclose factor 재구성)는 제공하나,
//       시가총액·발행주식수·업종 분류·상장폐지 종목군은 제공하지 않는다.
//   · scripts/backtest/data/universe.json 은 사용자 개인 CSV 내보내기에서 생성된 것으로
//     전체 시장 티커 목록이 아니다(개인 보유/관심 종목).
//   · scripts/·DB/·services/·docs/ 어디에도 역사적 point-in-time 시가총액,
//     역사적 GICS/WICS 업종 분류, 상장폐지 종목 리스트를 제공하는 소스가 없다.
//
// 규칙: `any` 금지, `console.*` 금지(순수 로직 — 구조화된 결과만 반환).
//        외부 URL 호출 없음(오프라인/정적).
// ---------------------------------------------------------------------------

import type {
  DataAuditResult,
  DataCapability,
  DataGateVerdict,
  DataManifest,
  DataSourceManifestEntry,
  HardStopCondition,
  HardStopConditionId,
} from '../../../types/backtestConditionalChannel';

const HYPOTHESIS_ID = 'conditional-channel-v1';
const RAW_DATA_DIR = 'scripts/backtest/data/conditionalChannel/';

/**
 * 확증 검증(PROMPT_3 §3·§5·§6)에 point-in-time으로 필요한 데이터 능력.
 * 이 집합 중 하나라도 AVAILABLE 소스가 없으면 관련 하드스톱이 met=true가 된다.
 */
const REQUIRED_CAPABILITIES: readonly DataCapability[] = [
  'OHLCV_ADJUSTED',
  'CORPORATE_ACTIONS',
  'POINT_IN_TIME_MARKETCAP',
  'POINT_IN_TIME_SECTOR',
  'DELISTED_UNIVERSE',
  'FULL_MARKET_TICKERS',
  'FX_HISTORY',
  'COST_SCHEDULE',
] as const;

/**
 * 정적 소스 감사 — 현재 이 저장소에서 도달 가능한 데이터 소스와 그 능력.
 * (라이브 프로빙 불가 환경이므로 명시적 하드코딩; 실제 조사 결과만 반영.)
 * 새 소스를 배선하면 이 배열을 갱신하고 runDataAudit()를 재실행한다.
 */
const STATIC_SOURCE_AUDIT: readonly DataSourceManifestEntry[] = [
  {
    sourceId: 'yahoo-v8-chart',
    provider: 'Yahoo Finance',
    endpoint: '/v8/finance/chart',
    capability: 'OHLCV_ADJUSTED',
    availability: 'AVAILABLE',
    reason: null,
    extractedAt: null, // 감사 시점엔 조회 안 함(능력 감사). 실제 추출 시 매니페스트에 기록.
    dataVersion: 'v8',
    period: null, // 심볼별 상이(요청 시 결정). 능력 감사에서는 미확정.
    market: 'BOTH',
    rowCount: null,
    missingRate: null,
    duplicateRate: null,
    adjustmentMethod: 'SPLIT_AND_DIVIDEND', // adjclose factor 재구성(총수익 조정 close).
    licenseConstraint: '개인 조사용 비공식 엔드포인트 — 원자료 커밋 금지, 재생성 명령만 보관',
    fileChecksum: null,
    isPointInTime: false, // 현재 상장된 티커 중심 — 상장폐지 종목/과거 종목군은 커버 못 함.
  },
  {
    sourceId: 'app-universe-json',
    provider: '사용자 개인 포트폴리오 CSV 내보내기',
    endpoint: 'scripts/backtest/data/universe.json',
    capability: 'FULL_MARKET_TICKERS',
    availability: 'NOT_AVAILABLE',
    reason:
      '개인 보유/관심 종목 목록이며 전체 시장(US 상장 보통주 + KOSPI/KOSDAQ 보통주) ' +
      'point-in-time 티커 목록이 아니다. 생존편향의 원천이므로 확증 종목군으로 쓸 수 없다.',
    extractedAt: null,
    dataVersion: null,
    period: null,
    market: 'BOTH',
    rowCount: null,
    missingRate: null,
    duplicateRate: null,
    adjustmentMethod: null,
    licenseConstraint: '개인 데이터 — 커밋 금지',
    fileChecksum: null,
    isPointInTime: false,
  },
  // ── 아래는 확증에 반드시 필요하나 현재 저장소에서 도달 불가능한 소스들 ──
  // (가짜 가용성 금지 — 명시적으로 NOT_AVAILABLE로 기록하고 사유를 남긴다.)
  {
    sourceId: 'pit-marketcap-source',
    provider: '(미확보 — CRSP/Compustat, S&P Capital IQ, FactSet, KRX 데이터 등 필요)',
    endpoint: '(none)',
    capability: 'POINT_IN_TIME_MARKETCAP',
    availability: 'NOT_AVAILABLE',
    reason:
      '역사적 발행주식수/시가총액(그 시점 값)을 제공하는 소스가 저장소에 없다. ' +
      'Yahoo v8은 시총/발행주식수 시계열을 주지 않는다. §6-1 대형주(80백분위) 판정 불가.',
    extractedAt: null,
    dataVersion: null,
    period: null,
    market: null,
    rowCount: null,
    missingRate: null,
    duplicateRate: null,
    adjustmentMethod: null,
    licenseConstraint: null,
    fileChecksum: null,
    isPointInTime: true, // 요구되는 성격(제공되면 point-in-time이어야 함). 현재 미확보.
  },
  {
    sourceId: 'pit-sector-source',
    provider: '(미확보 — GICS/WICS 역사적 분류 제공자 필요)',
    endpoint: '(none)',
    capability: 'POINT_IN_TIME_SECTOR',
    availability: 'NOT_AVAILABLE',
    reason:
      '해당 시점에 유효했던 업종 분류(GICS/WICS)와 유효 시작·종료일을 제공하는 소스가 없다. ' +
      '§6-2 카테고리 대장주(업종 시총 1위) 판정 불가. 현재 업종 소급은 하드스톱.',
    extractedAt: null,
    dataVersion: null,
    period: null,
    market: null,
    rowCount: null,
    missingRate: null,
    duplicateRate: null,
    adjustmentMethod: null,
    licenseConstraint: null,
    fileChecksum: null,
    isPointInTime: true,
  },
  {
    sourceId: 'delisted-universe-source',
    provider: '(미확보 — 상장폐지 포함 전체 종목군 + 상장폐지 대가/수익률 제공자 필요)',
    endpoint: '(none)',
    capability: 'DELISTED_UNIVERSE',
    availability: 'NOT_AVAILABLE',
    reason:
      '상장폐지·합병·티커변경·거래정지 종목을 포함한 point-in-time 투자 가능 종목군과 ' +
      '상장폐지 수익률/대가를 제공하는 소스가 없다. 생존편향 제거 불가.',
    extractedAt: null,
    dataVersion: null,
    period: null,
    market: null,
    rowCount: null,
    missingRate: null,
    duplicateRate: null,
    adjustmentMethod: null,
    licenseConstraint: null,
    fileChecksum: null,
    isPointInTime: true,
  },
  {
    sourceId: 'full-market-tickers-source',
    provider: '(미확보 — US 상장 보통주 + KOSPI/KOSDAQ 보통주 월말 point-in-time 목록 필요)',
    endpoint: '(none)',
    capability: 'FULL_MARKET_TICKERS',
    availability: 'NOT_AVAILABLE',
    reason:
      '월말 존재했던 정보로 다음 달 투자 가능 종목군을 확정(§5)할 수 있는 전체 시장 ' +
      'point-in-time 티커 목록 소스가 없다.',
    extractedAt: null,
    dataVersion: null,
    period: null,
    market: null,
    rowCount: null,
    missingRate: null,
    duplicateRate: null,
    adjustmentMethod: null,
    licenseConstraint: null,
    fileChecksum: null,
    isPointInTime: true,
  },
];

/** 특정 능력을 AVAILABLE로 제공하는 소스가 하나라도 있는가. */
function hasCapability(
  sources: readonly DataSourceManifestEntry[],
  capability: DataCapability
): boolean {
  return sources.some(
    (s) => s.capability === capability && s.availability === 'AVAILABLE'
  );
}

/** 특정 능력을 AVAILABLE + point-in-time으로 제공하는 소스가 있는가. */
function hasPointInTimeCapability(
  sources: readonly DataSourceManifestEntry[],
  capability: DataCapability
): boolean {
  return sources.some(
    (s) =>
      s.capability === capability &&
      s.availability === 'AVAILABLE' &&
      s.isPointInTime
  );
}

/**
 * PROMPT_3 §3의 8개 하드스톱 조건을 정적 소스 감사에 대해 평가한다.
 * 각 조건의 met(충족 → 게이트 실패 기여)과 evidence(근거)를 채운다.
 */
function evaluateHardStops(
  sources: readonly DataSourceManifestEntry[]
): HardStopCondition[] {
  const hasFullTickers = hasCapability(sources, 'FULL_MARKET_TICKERS');
  const hasPitMarketCap = hasPointInTimeCapability(sources, 'POINT_IN_TIME_MARKETCAP');
  const hasPitSector = hasPointInTimeCapability(sources, 'POINT_IN_TIME_SECTOR');
  const hasDelisted = hasCapability(sources, 'DELISTED_UNIVERSE');
  const hasCorpActions = hasCapability(sources, 'CORPORATE_ACTIONS');

  const conditions: HardStopCondition[] = [
    {
      id: 'RETROACTIVE_TICKER_LIST',
      description: '현재 종목 목록을 과거 전체 기간에 소급 적용해야 하는 경우',
      met: !hasFullTickers,
      evidence: hasFullTickers
        ? 'point-in-time 전체 시장 티커 목록 소스가 AVAILABLE.'
        : '전체 시장 point-in-time 티커 목록 소스 없음. 유일한 목록(universe.json)은 ' +
          '사용자 개인 보유/관심 종목이라 과거 소급 시 생존편향. → 조건 충족.',
    },
    {
      id: 'RETROACTIVE_MARKETCAP_SECTOR',
      description: '현재 시가총액이나 현재 업종을 과거 분류에 대신 써야 하는 경우',
      met: !hasPitMarketCap || !hasPitSector,
      evidence:
        !hasPitMarketCap || !hasPitSector
          ? `역사적 시가총액 소스=${hasPitMarketCap ? '있음' : '없음'}, ` +
            `역사적 업종 분류 소스=${hasPitSector ? '있음' : '없음'}. ` +
            '둘 중 하나라도 없으면 현재값 소급이 강제됨(§6-1·§6-2 판정 불가). → 조건 충족.'
          : 'point-in-time 시가총액·업종 분류 소스 모두 AVAILABLE.',
    },
    {
      id: 'NO_POINT_IN_TIME_UNIVERSE',
      description:
        '상장폐지·합병 종목을 포함한 point-in-time 투자 가능 종목군을 만들 수 없는 경우',
      met: !hasDelisted || !hasFullTickers,
      evidence:
        !hasDelisted || !hasFullTickers
          ? `상장폐지 포함 종목군 소스=${hasDelisted ? '있음' : '없음'}, ` +
            `전체 시장 티커 소스=${hasFullTickers ? '있음' : '없음'}. ` +
            'point-in-time 투자 가능 종목군을 구성할 수 없음. → 조건 충족.'
          : '상장폐지 포함 point-in-time 종목군 구성 가능.',
    },
    {
      id: 'UNRELIABLE_ADJUSTMENTS',
      description:
        '분할 조정, 거래정지, 중복 바 또는 통화 오류를 신뢰성 있게 처리할 수 없는 경우',
      met: !hasCorpActions,
      evidence: hasCorpActions
        ? '기업행위(분할/배당/합병) 소스가 AVAILABLE — 신뢰성 처리 가능.'
        : 'Yahoo v8 adjclose factor로 분할/배당 근사는 되나, 명시적 기업행위 레코드 ' +
          '(분할비율·거래정지 기간·중복바 판별) 소스가 없어 신뢰성 처리 보장 불가. → 조건 충족(보수적).',
    },
    {
      id: 'ARBITRARY_DELISTING_FILL',
      description: '상장폐지 수익을 대량으로 0 또는 최종 종가로 임의 대체해야 하는 경우',
      met: !hasDelisted,
      evidence: hasDelisted
        ? '상장폐지 대가/수익률 소스 AVAILABLE — 실제 값 반영 가능.'
        : '상장폐지 수익률/대가 소스가 없어 임의 대체가 불가피. → 조건 충족.',
    },
    {
      id: 'LOOKAHEAD_OR_SURVIVORSHIP',
      description: '룩어헤드 또는 생존편향을 제거할 수 없는 경우',
      met: !hasFullTickers || !hasDelisted,
      evidence:
        !hasFullTickers || !hasDelisted
          ? '전체 시장 point-in-time 종목군과 상장폐지 종목이 없으면 생존편향이 구조적으로 ' +
            '내재됨(살아남은 종목만 분석). → 조건 충족.'
          : '전체 종목군 + 상장폐지 데이터로 생존편향 제거 가능.',
    },
    {
      id: 'LOCKBOX_UNDER_3Y',
      description: '잠금 표본이 3년 미만인 경우',
      // 종목군 자체를 구성할 수 없으므로 3년 잠금 표본도 구성 불가 → 보수적으로 met.
      met: !hasFullTickers,
      evidence: hasFullTickers
        ? '공통 가용 기간의 마지막 20%로 3+완전연도 잠금 표본 구성 가능 여부를 별도 확인.'
        : 'point-in-time 종목군이 없어 잠금 표본(3+완전연도) 자체를 구성할 수 없음. → 조건 충족.',
    },
    {
      id: 'INSUFFICIENT_GROUP_SIZE',
      description:
        '어느 핵심 그룹이 시장별 30종목 미만이거나 잠금 표본에서 100회 미만 청산 거래인 경우',
      // 그룹 정의(large/leader)에 필요한 시총·업종이 없으므로 그룹 자체를 구성 불가 → met.
      met: !hasPitMarketCap || !hasPitSector,
      evidence:
        !hasPitMarketCap || !hasPitSector
          ? '그룹 A/B 정의에 필요한 시가총액·업종 분류가 없어 그룹 자체를 구성할 수 없음 ' +
            '(시장별 30종목·잠금 100청산거래 요건 확인 불가). → 조건 충족.'
          : '그룹별 종목 수·청산 거래 수를 실측으로 확인.',
    },
  ];

  return conditions;
}

/** 확증 진행에 필요한 외부 입력 요약(§3·§14 DATA_GAP). */
function buildRequiredExternalInputs(
  conditions: readonly HardStopCondition[]
): string[] {
  const inputs: string[] = [];
  const met = (id: HardStopConditionId): boolean =>
    conditions.some((c) => c.id === id && c.met);

  if (met('RETROACTIVE_TICKER_LIST') || met('NO_POINT_IN_TIME_UNIVERSE')) {
    inputs.push(
      'US 상장 보통주 + KOSPI/KOSDAQ 보통주의 월말 point-in-time 투자 가능 종목군 ' +
        '(상장폐지·합병·티커변경·거래정지 종목 포함). 제공처 예: CRSP/Compustat, ' +
        'S&P Capital IQ, FactSet, KRX 데이터 상품.'
    );
  }
  if (met('RETROACTIVE_MARKETCAP_SECTOR') || met('INSUFFICIENT_GROUP_SIZE')) {
    inputs.push(
      '역사적(그 시점) 발행주식수/시가총액 시계열 — §6-1 대형주(80백분위) 판정용.'
    );
    inputs.push(
      '역사적 GICS/WICS 등 표준 업종 분류(유효 시작·종료일 포함) — §6-2 카테고리 대장주 판정용.'
    );
  }
  if (met('ARBITRARY_DELISTING_FILL') || met('LOOKAHEAD_OR_SURVIVORSHIP')) {
    inputs.push(
      '상장폐지 대가/최종 수익률 데이터(합병 현금/주식 대가 포함) — 생존편향·임의대체 제거용.'
    );
  }
  if (met('UNRELIABLE_ADJUSTMENTS')) {
    inputs.push(
      '명시적 기업행위 레코드(분할 비율·현금배당·거래정지 기간) + 중복 바 판별 규칙.'
    );
  }
  inputs.push(
    '시장·연도별 공식 수수료·세율(한국 매도세 시행일 포함) — 오늘 세율 소급 금지(§11).'
  );
  inputs.push(
    '통합 KRW 원장을 만들 경우 거래일별 USD/KRW FX 시계열(보조 정책 분석용, §10).'
  );
  return inputs;
}

/**
 * 데이터 매니페스트를 조립한다(§14). 정적 소스 감사 + 재생성 지침.
 * @param generatedAt 감사 실행 시각(주입 가능; 미주입 시 호출부가 채움).
 */
export function buildDataManifest(generatedAt: string): DataManifest {
  return {
    hypothesisId: HYPOTHESIS_ID,
    generatedAt,
    sources: STATIC_SOURCE_AUDIT.map((s) => ({ ...s })),
    rawDataDir: RAW_DATA_DIR,
    recreateInstructions:
      '외부 point-in-time 소스(시가총액·업종·상장폐지 종목군)를 확보하면 ' +
      `${RAW_DATA_DIR} 아래에 (커밋 금지) 원자료를 배치하고, STATIC_SOURCE_AUDIT를 ` +
      'AVAILABLE로 갱신한 뒤 runDataAudit()를 재실행한다. 라이선스상 커밋 불가 파일은 ' +
      '체크섬(SHA-256)과 행 수만 매니페스트에 남긴다.',
  };
}

/**
 * PROMPT_3 §3 Phase 0 데이터 가능성 감사를 실행한다(정적 능력 감사).
 * 결정론적: 입력이 STATIC_SOURCE_AUDIT로 고정이므로 auditedAt 외에는 항상 동일 결과.
 *
 * @param auditedAt 감사 시각 ISO 문자열. 미주입 시 new Date().toISOString()으로 채운다.
 *   (이 파일은 Workflow 스크립트가 아닌 일반 TS 모듈이므로 Date 사용이 허용된다.
 *    결정론적 재현이 필요한 테스트는 auditedAt을 명시 주입하면 된다.)
 */
export function runDataAudit(auditedAt?: string): DataAuditResult {
  const timestamp = auditedAt ?? new Date().toISOString();
  const manifest = buildDataManifest(timestamp);
  const conditions = evaluateHardStops(manifest.sources);
  const metConditionIds = conditions.filter((c) => c.met).map((c) => c.id);
  const verdict: DataGateVerdict = metConditionIds.length === 0 ? 'PASS' : 'FAIL';
  const requiredExternalInputs = buildRequiredExternalInputs(conditions);

  return {
    hypothesisId: HYPOTHESIS_ID,
    auditedAt: timestamp,
    manifest,
    conditions,
    metConditionIds,
    verdict,
    requiredExternalInputs,
    auditScopeNote:
      '정적 능력 감사: 이 저장소에서 현재 도달 가능한 데이터 소스의 능력만을 대상으로 한다. ' +
      '라이브 외부 소스를 프로빙하지 않으며, 새 소스 배선 시 STATIC_SOURCE_AUDIT를 갱신 후 재실행한다. ' +
      `요구 능력 집합: [${REQUIRED_CAPABILITIES.join(', ')}].`,
  };
}
