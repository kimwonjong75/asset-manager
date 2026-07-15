// scripts/backtest/conditionalChannel/classifier.ts
// ---------------------------------------------------------------------------
// 조건부 돌파 채널 가설(PROMPT_3 §6) — 그룹 분류 순수 로직.
//
// 매월 말 m에 알 수 있었던 point-in-time 값으로 m+1월의 그룹 A/B를 확정한다(§6, 미래정보 금지).
//   · 대형주(large): 국가별 투자가능 종목군에서 총시가총액 상위 20%(80백분위 이상, §6-1)
//   · 대장주(leader): 투자가능 종목 ≥5인 업종에서 총시가총액 1위(§6-2)
//   · 그룹 A = large OR leader, 그룹 B = NOT large AND NOT leader (A의 정확한 여집합, §6-3·4)
//   · 진입 시점 그룹을 청산까지 동결(§6-5) — resolveFrozenGroup가 그 계약.
//
// ⚠ 이 파일의 함수는 "실데이터가 없다"는 사실을 알지도, 신경쓰지도 않는다.
//    주어진 PointInTimeMarketCap[]/PointInTimeSectorClassification[] 배열(실데이터든
//    테스트용 합성데이터든)에 대해 결정론적으로 올바르게 동작한다.
//
// 규칙: `any` 금지, `console.*` 금지(순수 로직), 외부 I/O 없음, Math.random 없음(결정론).
// ---------------------------------------------------------------------------

import type {
  IsoDate,
  Market,
  MonthlyGroupFlags,
  PointInTimeMarketCap,
  PointInTimeSectorClassification,
  PositionGroup,
} from '../../../types/backtestConditionalChannel';

// ===========================================================================
// 0. 월 키 유틸 — 월말 m 정보로 m+1월 그룹 확정(§6). 진입 월의 effectiveMonth로 그룹 조회.
// ===========================================================================

/** 'YYYY-MM-DD' → 'YYYY-MM'. 진입일이 속한 달(적용 월)을 뽑는다. */
export function monthKeyOf(date: IsoDate): string {
  return date.slice(0, 7);
}

/** 'YYYY-MM' 월말 m 기준 → 다음 달 'YYYY-MM'(적용 월 m+1). */
export function nextMonthKey(monthKey: string): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (month === 12) return `${year + 1}-01`;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// ===========================================================================
// 1. point-in-time 값 해석 — effectiveDate/effectiveStart~End로 그 시점 값 선택
// ===========================================================================

/**
 * asOfDate 시점에 유효한 시가총액 레코드(effectiveDate ≤ asOfDate 중 가장 최근).
 * 미래 값(effectiveDate > asOfDate)은 절대 사용하지 않는다(§6 미래정보 금지).
 */
export function resolveMarketCapAt(
  records: readonly PointInTimeMarketCap[],
  securityId: string,
  asOfDate: IsoDate
): PointInTimeMarketCap | null {
  let best: PointInTimeMarketCap | null = null;
  for (const r of records) {
    if (r.securityId !== securityId) continue;
    if (r.effectiveDate > asOfDate) continue; // 미래값 금지
    if (best === null || r.effectiveDate > best.effectiveDate) best = r;
  }
  return best;
}

/**
 * asOfDate 시점에 유효한 업종 분류(effectiveStart ≤ asOfDate ≤ effectiveEnd).
 * 겹치면 effectiveStart가 가장 최근인 것을 택한다. 미래 시작 분류는 사용 금지.
 */
export function resolveSectorAt(
  records: readonly PointInTimeSectorClassification[],
  securityId: string,
  asOfDate: IsoDate
): PointInTimeSectorClassification | null {
  let best: PointInTimeSectorClassification | null = null;
  for (const r of records) {
    if (r.securityId !== securityId) continue;
    if (r.effectiveStart > asOfDate) continue; // 미래 시작 금지
    if (r.effectiveEnd !== null && r.effectiveEnd < asOfDate) continue; // 이미 만료
    if (best === null || r.effectiveStart > best.effectiveStart) best = r;
  }
  return best;
}

// ===========================================================================
// 2. 결정론적 순위 — (시가총액 DESC, securityId ASC) 전순서
// ===========================================================================

interface Ranked {
  securityId: string;
  marketCap: number;
}

/**
 * 시가총액 내림차순, 동률은 securityId 오름차순으로 끊은 전순서(§6-1 tie-break).
 * 반환 배열의 index 0 = 1위(가장 큼). 결정론적.
 */
function rankByMarketCapDesc(items: readonly Ranked[]): Ranked[] {
  return [...items].sort((a, b) => {
    if (b.marketCap !== a.marketCap) return b.marketCap - a.marketCap; // 시총 DESC
    return a.securityId < b.securityId ? -1 : a.securityId > b.securityId ? 1 : 0; // securityId ASC
  });
}

// ===========================================================================
// 3. 월별 그룹 플래그 산출 (§6)
// ===========================================================================

/** computeMonthlyGroupFlags 입력 — 한 시장·한 월말 스냅샷. */
export interface MonthlyClassificationInput {
  market: Market;
  /** 산출 기준 월말 m (예: '2020-03-31'). */
  asOfMonthEnd: IsoDate;
  /** §5로 이미 걸러진 그 달 투자 가능 종목 ID 목록(보통주만, ETF/우선주 등 제외). */
  investableSecurityIds: readonly string[];
  marketCaps: readonly PointInTimeMarketCap[];
  sectors: readonly PointInTimeSectorClassification[];
  /** §6-1 대형주 경계 백분위(1차 = 80). */
  largeCapPercentile: number;
  /** §6-2 대장주 후보 최소 업종 규모(= 5). */
  leaderMinIndustrySize: number;
  /** 적용 월 m+1. 미지정 시 asOfMonthEnd의 다음 달로 자동 계산. */
  effectiveMonth?: string;
}

/**
 * 월별 그룹 플래그 산출(§6). 투자 가능 종목마다 정확히 하나의 MonthlyGroupFlags를 반환한다
 * (완전 분할 — isFullPartition으로 검증 가능).
 *
 * 대형주 판정: 시총 DESC 순위 rank(1=최대)에서 percentile = 100×(N−rank)/N.
 *   large ⟺ percentile ≥ largeCapPercentile ⟺ rank ≤ N×(100−p)/100 = 상위 (100−p)%.
 *   동률은 rankByMarketCapDesc의 securityId 오름차순으로 끊는다(경계 동률도 결정론적).
 * 시총이 없는 투자가능 종목: point-in-time 시가총액을 해석할 수 없어 대형주·대장주 판정이 불가능하다.
 *   → `unclassifiable=true`로 표시하고 그룹 A/B 확증 분석에서 **제외**한다(Bug2 수정).
 *   과거에는 이런 종목이 large=false·leader=false로 조용히 그룹 B에 흡수됐는데, 그러면 B가
 *   "미분류 잔여 버킷"으로 오염되어 편향이 생긴다(§6 확증 분석 무결성). group 필드는 타입상
 *   'B'로 채우되 unclassifiable=true가 우선하며, 그 값은 참고용(무의미)이다.
 */
export function computeMonthlyGroupFlags(
  input: MonthlyClassificationInput
): MonthlyGroupFlags[] {
  const {
    market,
    asOfMonthEnd,
    investableSecurityIds,
    marketCaps,
    sectors,
    largeCapPercentile,
    leaderMinIndustrySize,
  } = input;
  const effectiveMonth = input.effectiveMonth ?? nextMonthKey(monthKeyOf(asOfMonthEnd));

  // 중복 ID 제거 + 결정론적 정렬(securityId ASC)로 순회 순서 고정.
  const uniqueIds = Array.from(new Set(investableSecurityIds)).sort();

  // 각 종목의 그 시점 시총·업종 해석.
  interface Resolved {
    securityId: string;
    marketCap: number | null;
    sectorCode: string | null;
  }
  const resolved: Resolved[] = uniqueIds.map((securityId) => {
    const mc = resolveMarketCapAt(marketCaps, securityId, asOfMonthEnd);
    const sec = resolveSectorAt(sectors, securityId, asOfMonthEnd);
    return {
      securityId,
      marketCap: mc ? mc.marketCap : null,
      sectorCode: sec ? sec.sectorCode : null,
    };
  });

  // ── 대형주 판정: 시총 있는 종목만 순위화 ──
  const withCap: Ranked[] = resolved
    .filter((r): r is Resolved & { marketCap: number } => r.marketCap !== null)
    .map((r) => ({ securityId: r.securityId, marketCap: r.marketCap }));
  const rankedCap = rankByMarketCapDesc(withCap);
  const N = rankedCap.length;
  const rankOf = new Map<string, number>(); // 1-based, 1 = 최대 시총
  rankedCap.forEach((r, i) => rankOf.set(r.securityId, i + 1));

  const percentileOf = (securityId: string): number | null => {
    const rank = rankOf.get(securityId);
    if (rank === undefined || N === 0) return null;
    return (100 * (N - rank)) / N;
  };
  const largeThresholdRank = (N * (100 - largeCapPercentile)) / 100; // rank ≤ 이면 large

  // ── 대장주 판정: 업종별(시총 있는 종목만) 순위 ──
  const sectorMembers = new Map<string, Ranked[]>();
  for (const r of resolved) {
    if (r.marketCap === null || r.sectorCode === null) continue;
    const arr = sectorMembers.get(r.sectorCode) ?? [];
    arr.push({ securityId: r.securityId, marketCap: r.marketCap });
    sectorMembers.set(r.sectorCode, arr);
  }
  const sectorLeader = new Map<string, string>(); // sectorCode → leader securityId
  const sectorInvestableCount = new Map<string, number>();
  const sectorRankOf = new Map<string, number>(); // securityId → 업종 내 순위(1=대장주)
  for (const [sectorCode, members] of sectorMembers) {
    const rankedSector = rankByMarketCapDesc(members);
    sectorInvestableCount.set(sectorCode, rankedSector.length);
    rankedSector.forEach((r, i) => sectorRankOf.set(r.securityId, i + 1));
    if (rankedSector.length >= leaderMinIndustrySize) {
      sectorLeader.set(sectorCode, rankedSector[0].securityId); // 시총 1위 = 대장주
    }
  }

  // ── 플래그 조립 ──
  return resolved.map((r): MonthlyGroupFlags => {
    // 시총 해석 불가 → 대형주·대장주 판정 자체가 불가능 → 확증 A/B 분석에서 제외(Bug2).
    const unclassifiable = r.marketCap === null;
    const percentile = percentileOf(r.securityId);
    const rank = rankOf.get(r.securityId);
    const large = !unclassifiable && rank !== undefined && rank <= largeThresholdRank;
    const leader =
      !unclassifiable && r.sectorCode !== null && sectorLeader.get(r.sectorCode) === r.securityId;
    // group은 타입상 non-null이라 'B'로 채우되, unclassifiable=true가 우선하며 이 값은 무의미.
    const group: PositionGroup = large || leader ? 'A' : 'B';
    const secCount = r.sectorCode !== null ? sectorInvestableCount.get(r.sectorCode) ?? null : null;

    return {
      securityId: r.securityId,
      market,
      asOfMonthEnd,
      effectiveMonth,
      investable: true,
      marketCap: r.marketCap,
      marketCapPercentile: percentile,
      large,
      sectorCode: r.sectorCode,
      sectorRankByMarketCap: sectorRankOf.get(r.securityId) ?? null,
      sectorInvestableCount: secCount,
      leader,
      group,
      unclassifiable,
      tieBreakNote:
        '대형주·대장주 순위는 (시총 DESC, securityId ASC)로 결정론적 tie-break. ' +
        `large ⟺ 시총순위 ≤ N×(100−${largeCapPercentile})/100. ` +
        '시총 해석 불가 종목은 unclassifiable=true로 A/B에서 제외.',
    };
  });
}

// ===========================================================================
// 4. 진입 시 그룹 동결(§6-5) — 시뮬레이터가 진입 1회만 호출, 청산까지 재산출 금지
// ===========================================================================

/**
 * 진입일이 속한 적용 월(effectiveMonth)의 플래그로 종목의 그룹을 확정한다(§6-5).
 * 시뮬레이터는 진입 시점에 이 함수를 딱 한 번 호출해 그룹을 얼려 두고,
 * 보유 도중 월이 바뀌어도 절대 재산출하지 않는다.
 *
 * @returns 해당 월 투자 가능·분류 가능 플래그가 있으면 그 group, 없으면 null.
 *   null 사유는 (a) 그 월 플래그 없음 또는 (b) unclassifiable(시총 해석 불가) 둘 다 포함한다.
 *   두 사유를 구분해야 하면 resolveFrozenClassification()을 쓴다.
 */
export function resolveFrozenGroup(
  flags: readonly MonthlyGroupFlags[],
  securityId: string,
  entryDate: IsoDate
): PositionGroup | null {
  const applyMonth = monthKeyOf(entryDate);
  for (const f of flags) {
    if (f.securityId === securityId && f.effectiveMonth === applyMonth && f.investable) {
      return f.unclassifiable ? null : f.group; // unclassifiable → 제외(Bug2)
    }
  }
  return null;
}

/** 진입 시 동결 분류 결과 — 그룹뿐 아니라 "왜 null인지"를 구분해 시뮬레이터가 처리 분기하도록 한다. */
export interface FrozenClassification {
  /** 그 (종목, 적용월)에 투자 가능 플래그가 존재하는가. false면 그 달 종목군에 없음. */
  hasFlag: boolean;
  /** 플래그는 있으나 시총 해석 불가로 A/B 판정 불가(Bug2). group은 null. */
  unclassifiable: boolean;
  /** 분류 가능하면 A/B, 아니면 null(hasFlag=false 또는 unclassifiable=true). */
  group: PositionGroup | null;
}

/**
 * 진입일 적용 월의 플래그로 동결 분류를 해석한다(§6-5). resolveFrozenGroup의 상세판.
 * 시뮬레이터가 "그 달 종목군에 없음(hasFlag=false)"과 "있지만 미분류(unclassifiable=true)"를
 * 구분해 다르게 처리(전자=후보 제외, 후자=A/B전략에서 UNFILLED)할 수 있게 한다.
 */
export function resolveFrozenClassification(
  flags: readonly MonthlyGroupFlags[],
  securityId: string,
  entryDate: IsoDate
): FrozenClassification {
  const applyMonth = monthKeyOf(entryDate);
  for (const f of flags) {
    if (f.securityId === securityId && f.effectiveMonth === applyMonth && f.investable) {
      if (f.unclassifiable) return { hasFlag: true, unclassifiable: true, group: null };
      return { hasFlag: true, unclassifiable: false, group: f.group };
    }
  }
  return { hasFlag: false, unclassifiable: false, group: null };
}

// ===========================================================================
// 5. 분할 불변식 — 모든 투자가능 종목이 정확히 하나의 그룹에 속하는가(§6 테스트용)
// ===========================================================================

/**
 * 완전 분할 검증(§15, Bug2 개정): 불변식은 "모든 투자가능-**그리고-분류가능**(!unclassifiable) 종목이
 * 정확히 A/B 중 하나에 속한다"이다. unclassifiable 종목은 A/B 분할에서 **제외**되며 B로 흡수되지
 * 않아야 한다(그래야 B가 미분류 잔여 버킷으로 오염되지 않음).
 *
 * 검증 항목:
 *   · 투자가능 종목마다 정확히 1개 플래그(누락/중복 없음).
 *   · 분류가능 종목: group∈{A,B} & A ⟺ (large∨leader) & B ⟺ (¬large∧¬leader).
 *   · unclassifiable 종목: large=false·leader=false여야 함(미분류인데 A로 새면 안 됨).
 * 위반 사유 목록을 반환한다(빈 배열 = 완전 분할).
 */
export function checkFullPartition(
  flags: readonly MonthlyGroupFlags[],
  investableSecurityIds: readonly string[]
): string[] {
  const problems: string[] = [];
  const expected = new Set(investableSecurityIds);
  const seen = new Map<string, number>();

  for (const f of flags) {
    seen.set(f.securityId, (seen.get(f.securityId) ?? 0) + 1);
    if (f.unclassifiable) {
      // 미분류 종목은 A/B 분할 대상이 아니다 — large/leader가 켜져 있으면 오류(A로 샘).
      if (f.large || f.leader) {
        problems.push(`${f.securityId}: unclassifiable인데 large/leader=true(A로 유출)`);
      }
      continue; // group 값은 무의미하므로 A/B 불변식 미적용
    }
    if (f.group !== 'A' && f.group !== 'B') {
      problems.push(`${f.securityId}: group이 A/B가 아님(${String(f.group)})`);
    }
    const expectA = f.large || f.leader;
    if (expectA && f.group !== 'A') {
      problems.push(`${f.securityId}: large||leader인데 group≠A`);
    }
    if (!expectA && f.group !== 'B') {
      problems.push(`${f.securityId}: !large&&!leader인데 group≠B`);
    }
  }
  for (const id of expected) {
    const count = seen.get(id) ?? 0;
    if (count === 0) problems.push(`${id}: 투자가능인데 플래그 없음(분할 누락)`);
    if (count > 1) problems.push(`${id}: 플래그 ${count}개(중복 분할)`);
  }
  for (const id of seen.keys()) {
    if (!expected.has(id)) problems.push(`${id}: 투자가능 목록에 없는데 플래그 존재`);
  }
  return problems;
}
