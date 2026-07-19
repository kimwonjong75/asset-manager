// utils/marketDistribution.ts
// 오닐 디스트리뷰션 데이 빌더/카운터 — 종목·지수 공용 유틸
//
// 텍스트의 본래 의도: 디스트리뷰션 데이는 "시장 지수"(S&P500/NASDAQ/KOSPI)에 적용하는 도구지만,
// 개별 종목에도 동일 알고리즘으로 매물 출회 패턴을 식별할 수 있음.
// 이 유틸은 raw OHLCV → 메타 빌더와, 메타 → 카운트의 두 함수를 분리해
// useEnrichedIndicators(종목)와 useMarketDistributionDays(지수)에서 공용 사용한다.

/** 디스트리뷰션 판정 메타 (1거래일치) */
export interface DistributionDayMeta {
  /** 거래량 / volumeAvgPeriod일 trailing 평균 — 평균 산출 불가 시 null */
  volRatio: number | null;
  /** 종가 < 시가 (음봉). open 시계열 미수신 시 null */
  isBearish: boolean | null;
  /** 종가가 당일 (고-저) 구간의 하위 50%에서 마감. high/low 미수신 시 null */
  isLowerHalfClose: boolean | null;
  /** 등락률 (close - prevClose) / prevClose */
  changeRatio: number;
}

interface BuildDistributionMetaOptions {
  /** 메타 시계열 끝에서 몇 일치를 반환할지 (기본 30) */
  metaLength?: number;
  /** trailing 평균거래량 산출 일수 (기본 50) */
  volumeAvgPeriod?: number;
}

/** trailing 평균 거래량 — i 미포함, period * 0.8 이상 데이터 필요 (룩어헤드 방지) */
function trailingVolumeAvg(volumes: (number | null)[], i: number, period: number): number | null {
  if (i < period) return null;
  let sum = 0;
  let count = 0;
  for (let j = i - period; j < i; j++) {
    const v = volumes[j];
    if (typeof v === 'number') {
      sum += v;
      count++;
    }
  }
  if (count < period * 0.8) return null;
  return sum / count;
}

/**
 * raw OHLCV 시계열 → 최근 metaLength일치 DistributionDayMeta[]
 * 모든 시계열은 동일 길이, 날짜 오름차순 정렬되어야 함.
 * 값이 없는 일자는 null로 채워서 전달할 것 (alignSeries 사용).
 * OHLCV 일부 미수신 시 해당 메타 필드는 null로 fallback (계산 가능한 범위에서만 평가)
 */
export function buildDistributionMeta(
  opens: (number | null)[],
  highs: (number | null)[],
  lows: (number | null)[],
  closes: (number | null)[],
  volumes: (number | null)[],
  options: BuildDistributionMetaOptions = {}
): DistributionDayMeta[] {
  const metaLength = options.metaLength ?? 30;
  const volumeAvgPeriod = options.volumeAvgPeriod ?? 50;

  const n = closes.length;
  const out: DistributionDayMeta[] = [];
  const start = Math.max(0, n - metaLength);

  for (let i = start; i < n; i++) {
    const avgVol = trailingVolumeAvg(volumes, i, volumeAvgPeriod);
    const v = volumes[i];
    const volRatio =
      typeof v === 'number' && typeof avgVol === 'number' && avgVol > 0
        ? v / avgVol
        : null;
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const pc = i > 0 ? closes[i - 1] : null;
    const isBearish: boolean | null =
      typeof o === 'number' && typeof c === 'number' ? c < o : null;
    const isLowerHalfClose: boolean | null =
      typeof h === 'number' && typeof l === 'number' && typeof c === 'number' && h > l
        ? (c - l) / (h - l) < 0.5
        : null;
    const changeRatio =
      typeof pc === 'number' && pc > 0 && typeof c === 'number'
        ? (c - pc) / pc
        : 0;
    out.push({ volRatio, isBearish, isLowerHalfClose, changeRatio });
  }

  return out;
}

/**
 * 메타 배열에서 윈도우 내 매물 출회 패턴 일수 카운트
 * 패턴: volRatio >= ratioThr AND (음봉 OR 윗꼬리 마감 OR 등락률 < 0.2%)
 * OHLCV 미수신 시 isBearish/isLowerHalfClose는 null → 정체(changeRatio<0.002) 조건만 평가
 */
export function countDistributionDays(
  meta: DistributionDayMeta[] | undefined | null,
  windowDays: number,
  volumeRatioThreshold: number
): number {
  if (!meta || meta.length === 0) return 0;
  const useWindow = Math.min(Math.max(1, windowDays), meta.length);
  let count = 0;
  for (let i = meta.length - useWindow; i < meta.length; i++) {
    const d = meta[i];
    if (typeof d.volRatio !== 'number' || d.volRatio < volumeRatioThreshold) continue;
    const churn =
      d.isBearish === true ||
      d.isLowerHalfClose === true ||
      d.changeRatio < 0.002;
    if (churn) count++;
  }
  return count;
}

/**
 * 디스트리뷰션 카운트가 의미 있으려면 메타가 존재하고 volRatio가 산출된 날이 최소 하나 있어야 한다.
 * volRatio 전부 null(거래량 결손)이면 카운트가 0으로 degrade — fail-closed 판정용 단일 소스.
 * alertDiagnostics.compositeInputQuality의 'missing' 경계 + guruSignalEngine.buildMetricValues가 공유(drift 차단).
 *
 * @param windowDays (선택) 지정 시 **최근 windowDays일치 창**에서만 유효 volRatio를 찾는다.
 *   미지정(기본)이면 전체 meta 대상 — **기존 호출부(alertDiagnostics/guruSignalEngine) 동작 100% 보존**.
 *   종목 검토 패널은 실제 평가창(distributionWindow=13)을 넘겨 14~30일차 결측이 최근 신호를 가리지 않게 한다.
 */
export function hasDistributionInputs(
  meta: DistributionDayMeta[] | undefined | null,
  windowDays?: number,
): boolean {
  if (!meta || meta.length === 0) return false;
  const scope = typeof windowDays === 'number' && windowDays > 0 ? meta.slice(-windowDays) : meta;
  return scope.some(m => typeof m.volRatio === 'number');
}
