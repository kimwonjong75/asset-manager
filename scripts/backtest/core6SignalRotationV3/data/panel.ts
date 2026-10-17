// scripts/backtest/core6SignalRotationV3/data/panel.ts
// Yahoo 파싱 결과 → KRX 세션 달력에 정렬된 TR 조정 OHLC 패널(P / P5 / PA). 순수 함수만(fs·네트워크 없음).
// 전략 성과(MDD·CAGR 등)는 이 모듈에서 계산하지 않는다 — 데이터 정합만 다룬다.
// 사양: docs/backtest/PREREG_코어6종_신호로테이션_V3.md §2(기간) §4.2(TR 장부) §5(결측) §6(464470 합성)

import type { AssetBars, AssetCode, BarSource, Panel } from '../types';
import { ASSET_CODES } from '../types';
import { adjCloseSeries, indexRowsByDate, rawCloseSeries } from './yahoo';
import type { DatedValue, YahooParsed, YahooRow } from './yahoo';

export const PANEL_START = '2021-12-15';
export const PANEL_END = '2026-09-30';
export const SYNTH_ASSET: AssetCode = '464470';

/**
 * 세션 달력 판정 규칙.
 *  - majority-valid (주): 6개 한국 ETF 중 "그날 이미 상장한 것"의 과반(>1/2)이 유효한 O/H/L/C를 가진 날 = 세션.
 *    Yahoo가 행은 만들었지만 값이 전부 null인 날은 세션이 아니다(달력에서 빠지고 `dropped`로 보고).
 *  - yahoo-rows (민감도): Yahoo에 행이 존재하면(값이 null이어도) 세션으로 본다. 실제 영업일 결측을 이월행으로 보존하는 해석.
 */
export type CalendarRule = 'majority-valid' | 'yahoo-rows';
export type RowStatus = 'valid' | 'null' | 'none' | 'unlisted';

export interface DroppedDay {
  date: string;
  /** 0=일 … 6=토 */
  weekday: number;
  status: Record<AssetCode, RowStatus>;
}

export interface CalendarResult {
  rule: CalendarRule;
  dates: string[];
  dropped: DroppedDay[];
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** 자산별 첫 유효 행 날짜(없으면 null). 이 날짜 이후를 "상장 후"로 본다. */
export function firstValidDate(parsed: YahooParsed): string | null {
  let first: string | null = null;
  for (const row of parsed.rows) {
    if (row.valid && (first === null || row.date < first)) first = row.date;
  }
  return first;
}

export function buildSessionCalendar(
  kr: Record<AssetCode, YahooParsed>,
  start: string = PANEL_START,
  end: string = PANEL_END,
  rule: CalendarRule = 'majority-valid'
): CalendarResult {
  const index = {} as Record<AssetCode, Map<string, YahooRow>>;
  const listedFrom = {} as Record<AssetCode, string | null>;
  const union = new Set<string>();
  for (const code of ASSET_CODES) {
    index[code] = indexRowsByDate(kr[code]);
    listedFrom[code] = firstValidDate(kr[code]);
    for (const date of index[code].keys()) if (date >= start && date <= end) union.add(date);
  }
  const dates: string[] = [];
  const dropped: DroppedDay[] = [];
  for (const date of [...union].sort()) {
    const status = {} as Record<AssetCode, RowStatus>;
    let listed = 0;
    let present = 0;
    for (const code of ASSET_CODES) {
      const from = listedFrom[code];
      const row = index[code].get(date);
      if (from === null || date < from) {
        status[code] = 'unlisted';
        continue;
      }
      listed++;
      if (!row) status[code] = 'none';
      else if (row.valid) {
        status[code] = 'valid';
        present++;
      } else {
        status[code] = 'null';
        if (rule === 'yahoo-rows') present++;
      }
    }
    if (listed > 0 && present * 2 > listed) dates.push(date);
    else dropped.push({ date, weekday: weekdayOf(date), status });
  }
  return { rule, dates, dropped };
}

// ---------------------------------------------------------------------------
// 실제 ETF 봉
// ---------------------------------------------------------------------------

function emptyBars(code: AssetCode, n: number): AssetBars {
  return {
    code,
    open: new Array<number | null>(n).fill(null),
    high: new Array<number | null>(n).fill(null),
    low: new Array<number | null>(n).fill(null),
    close: new Array<number | null>(n).fill(null),
    fresh: new Array<boolean>(n).fill(false),
    source: new Array<BarSource>(n).fill('absent'),
  };
}

/**
 * 실제 ETF를 세션 달력에 정렬한다.
 *  - 상장 전(첫 유효 행 이전): source='absent', 가격 null, fresh=false.
 *  - 상장 후 세션에 유효 행이 있으면 그 봉(fresh=true). 없으면 직전 봉을 그대로 이월하고 fresh=false(source는 'actual').
 */
export function buildActualBars(code: AssetCode, dates: string[], parsed: YahooParsed): AssetBars {
  const bars = emptyBars(code, dates.length);
  const index = indexRowsByDate(parsed);
  // 패널 시작 이전의 마지막 유효 봉(이미 상장한 자산이 첫 세션에 결측일 때 이월 기준)
  let last: YahooRow | null = null;
  if (dates.length > 0) {
    for (const row of parsed.rows) {
      if (row.valid && row.date < dates[0] && (last === null || row.date > last.date)) last = row;
    }
  }
  for (let i = 0; i < dates.length; i++) {
    const row = index.get(dates[i]);
    if (row && row.valid) {
      last = row;
      bars.open[i] = row.open;
      bars.high[i] = row.high;
      bars.low[i] = row.low;
      bars.close[i] = row.close;
      bars.fresh[i] = true;
      bars.source[i] = 'actual';
    } else if (last) {
      bars.open[i] = last.open;
      bars.high[i] = last.high;
      bars.low[i] = last.low;
      bars.close[i] = last.close;
      bars.fresh[i] = false;
      bars.source[i] = 'actual';
    }
  }
  return bars;
}

// ---------------------------------------------------------------------------
// 464470 합성 (사양 §6)
// ---------------------------------------------------------------------------

export interface SyntheticDay {
  date: string;
  /** 스케일 전 합성가 P_D = TLT 조정종가(날짜 < D 최근) × USDKRW 종가(날짜 < D 최근) */
  price: number;
  tltDate: string;
  fxDate: string;
  /** 직전 세션과 다른 미국(TLT) 봉에서 왔을 때만 true. 같은 미국 봉이 반복(미국 휴장 등)되면 false. */
  fresh: boolean;
}

/**
 * 세션 D마다 날짜 < D 인 입력만 써서 합성가를 만든다(미래 값 사용 금지).
 * @param dates 오름차순 세션 날짜
 * @param tlt   TLT 조정종가(오름차순)
 * @param fx    USD/KRW 종가(오름차순)
 * @returns dates와 같은 길이. 입력이 아직 없으면 null.
 */
export function computeSyntheticDays(dates: string[], tlt: DatedValue[], fx: DatedValue[]): (SyntheticDay | null)[] {
  const out: (SyntheticDay | null)[] = [];
  let ti = -1;
  let fi = -1;
  let prev: SyntheticDay | null = null;
  for (const date of dates) {
    while (ti + 1 < tlt.length && tlt[ti + 1].date < date) ti++;
    while (fi + 1 < fx.length && fx[fi + 1].date < date) fi++;
    if (ti < 0 || fi < 0) {
      out.push(null);
      prev = null;
      continue;
    }
    const day: SyntheticDay = {
      date,
      price: tlt[ti].value * fx[fi].value,
      tltDate: tlt[ti].date,
      fxDate: fx[fi].date,
      fresh: prev === null || prev.tltDate !== tlt[ti].date,
    };
    out.push(day);
    prev = day;
  }
  return out;
}

export interface SpliceInfo {
  listingDate: string;
  actualFirstClose: number;
  syntheticAtListing: number;
  /** c = 실제 첫 조정 종가 / 합성 P(상장일). 합성 구간 전체에 곱한다. */
  scale: number;
}

export function computeSpliceScale(
  listingDate: string,
  actualFirstClose: number,
  tlt: DatedValue[],
  fx: DatedValue[]
): SpliceInfo | null {
  const day = computeSyntheticDays([listingDate], tlt, fx)[0];
  if (!day || !(day.price > 0) || !(actualFirstClose > 0)) return null;
  return { listingDate, actualFirstClose, syntheticAtListing: day.price, scale: actualFirstClose / day.price };
}

// ---------------------------------------------------------------------------
// 패널 빌더
// ---------------------------------------------------------------------------

export interface PanelInput {
  kr: Record<AssetCode, YahooParsed>;
  tlt: YahooParsed;
  fx: YahooParsed;
}

export interface PanelOptions {
  /** true = P(464470 상장 전 합성 포함), false = P5(464470 전 기간 absent) */
  includeSynthetic464470: boolean;
  calendarRule?: CalendarRule;
  start?: string;
  end?: string;
}

export interface SyntheticMeta {
  splice: SpliceInfo;
  syntheticSessions: number;
  syntheticFreshSessions: number;
  syntheticFirstDate: string | null;
  syntheticLastDate: string | null;
  /** 이음새: 마지막 합성 세션 종가(스케일 후) → 상장일 실제 시가/종가 변화율. 실제 괴리로 보고한다. */
  seam: { lastSyntheticDate: string; lastSyntheticClose: number; actualOpenGap: number | null; actualCloseReturn: number } | null;
}

export interface PanelBuild {
  panel: Panel;
  calendar: CalendarResult;
  synthetic: SyntheticMeta | null;
}

export function buildPanelWithMeta(input: PanelInput, options: PanelOptions): PanelBuild {
  const calendar = buildSessionCalendar(input.kr, options.start ?? PANEL_START, options.end ?? PANEL_END, options.calendarRule ?? 'majority-valid');
  const dates = calendar.dates;
  const assets = {} as Record<AssetCode, AssetBars>;
  for (const code of ASSET_CODES) assets[code] = buildActualBars(code, dates, input.kr[code]);

  let synthetic: SyntheticMeta | null = null;
  if (!options.includeSynthetic464470) {
    assets[SYNTH_ASSET] = emptyBars(SYNTH_ASSET, dates.length);
  } else {
    const actual = assets[SYNTH_ASSET];
    const listingIdx = actual.source.findIndex(s => s === 'actual');
    if (listingIdx < 0) throw new Error('464470 실제 봉이 달력에 없어 합성 이음새를 계산할 수 없다');
    const listingClose = actual.close[listingIdx];
    if (listingClose === null) throw new Error('464470 상장일 종가 없음');
    const tlt = adjCloseSeries(input.tlt);
    const fx = rawCloseSeries(input.fx);
    const splice = computeSpliceScale(dates[listingIdx], listingClose, tlt, fx);
    if (!splice) throw new Error('464470 합성 스케일 계산 실패(입력 부족)');
    const synth = computeSyntheticDays(dates.slice(0, listingIdx), tlt, fx);
    let freshCount = 0;
    let first: string | null = null;
    let last: string | null = null;
    for (let i = 0; i < listingIdx; i++) {
      const day = synth[i];
      if (!day) continue; // 입력 없음 → absent 유지
      const p = day.price * splice.scale;
      actual.open[i] = p;
      actual.high[i] = p;
      actual.low[i] = p;
      actual.close[i] = p;
      actual.fresh[i] = day.fresh;
      actual.source[i] = 'synthetic';
      if (day.fresh) freshCount++;
      if (first === null) first = dates[i];
      last = dates[i];
    }
    let seam: SyntheticMeta['seam'] = null;
    if (last !== null) {
      const lastIdx = dates.indexOf(last);
      const lastClose = actual.close[lastIdx];
      const open0 = actual.open[listingIdx];
      if (lastClose !== null && lastClose > 0) {
        seam = {
          lastSyntheticDate: last,
          lastSyntheticClose: lastClose,
          actualOpenGap: open0 === null ? null : open0 / lastClose - 1,
          actualCloseReturn: listingClose / lastClose - 1,
        };
      }
    }
    synthetic = {
      splice,
      syntheticSessions: first === null ? 0 : actual.source.filter(s => s === 'synthetic').length,
      syntheticFreshSessions: freshCount,
      syntheticFirstDate: first,
      syntheticLastDate: last,
      seam,
    };
  }
  return { panel: { dates, assets }, calendar, synthetic };
}

/** P (주): 6종, 464470은 상장 전 합성 + 이후 실제. */
export function buildPanelP(input: PanelInput, calendarRule: CalendarRule = 'majority-valid'): Panel {
  return buildPanelWithMeta(input, { includeSynthetic464470: true, calendarRule }).panel;
}

/** P5 (통제): 464470을 전 기간 absent로 둔 5종. 달력은 P와 동일(6종 기준)이라 날짜가 정확히 일치한다. */
export function buildPanelP5(input: PanelInput, calendarRule: CalendarRule = 'majority-valid'): Panel {
  return buildPanelWithMeta(input, { includeSynthetic464470: false, calendarRule }).panel;
}

/** 날짜 범위(양끝 포함)로 패널을 자른다. PA(2023-08-22~2026-09-30) 구성용. */
export function slicePanel(panel: Panel, startDate: string, endDate: string): Panel {
  const idx: number[] = [];
  panel.dates.forEach((d, i) => {
    if (d >= startDate && d <= endDate) idx.push(i);
  });
  const lo = idx.length > 0 ? idx[0] : 0;
  const hi = idx.length > 0 ? idx[idx.length - 1] + 1 : 0;
  const assets = {} as Record<AssetCode, AssetBars>;
  for (const code of ASSET_CODES) {
    const a = panel.assets[code];
    assets[code] = {
      code,
      open: a.open.slice(lo, hi),
      high: a.high.slice(lo, hi),
      low: a.low.slice(lo, hi),
      close: a.close.slice(lo, hi),
      fresh: a.fresh.slice(lo, hi),
      source: a.source.slice(lo, hi),
    };
  }
  return { dates: panel.dates.slice(lo, hi), assets };
}

/** 패널 구조 불변식 점검: 모든 배열 길이 = dates.length, 날짜 오름차순·중복 없음. 위반 목록을 돌려준다(빈 배열 = 정상). */
export function validatePanelShape(panel: Panel): string[] {
  const problems: string[] = [];
  const n = panel.dates.length;
  for (let i = 1; i < n; i++) {
    if (!(panel.dates[i] > panel.dates[i - 1])) problems.push(`dates not strictly ascending at ${i}: ${panel.dates[i - 1]} -> ${panel.dates[i]}`);
  }
  for (const code of ASSET_CODES) {
    const a = panel.assets[code];
    for (const key of ['open', 'high', 'low', 'close', 'fresh', 'source'] as const) {
      if (a[key].length !== n) problems.push(`${code}.${key} length ${a[key].length} != ${n}`);
    }
  }
  return problems;
}
