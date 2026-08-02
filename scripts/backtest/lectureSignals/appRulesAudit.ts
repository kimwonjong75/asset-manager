// scripts/backtest/lectureSignals/appRulesAudit.ts
// ---------------------------------------------------------------------------
// P4 부속 — **앱 경로 직접 대조 감사**.
//
// 계획서 v2 §3 P4: "앱 규칙을 백테스트에서 재현하는 것이므로 패리티 위험이 있다.
//   재현 코드는 앱 로직을 읽어 백테스트 측에 독립 구현하고, **동일 날짜·동일 종목 신호 일치율**을
//   함께 보고한다."
//
// 여기서 하는 일:
//   (1) 같은 (종목·날짜·보유상태)에 대해
//         A. 앱의 실제 함수 경로: utils/buildEnrichedIndicator → utils/alertChecker.matchesRule
//         B. 백테스트 재현 경로 : appRules.buildAppIndicatorSeries → evaluateAppSellRules
//       를 각각 돌려 규칙 13종의 boolean을 1:1 비교한다.
//   (2) 앱 런타임이 실제로 받는 히스토리 길이(약 300거래일)만 넣었을 때 판정이 얼마나 달라지는지
//       (앱 자체의 특성 — 재현 오류가 아님)를 정량화한다.
//
// 앱 코드는 **import만** 한다(수정 금지).
//
// 규칙: `any`·`Math.random` 금지. console은 드라이버에서만.
// ---------------------------------------------------------------------------

import { mulberry32 } from '../conditionalChannel/statistics';
import { buildEnrichedIndicator } from '../../../utils/buildEnrichedIndicator';
import { matchesRule } from '../../../utils/alertChecker';
import { DEFAULT_ALERT_RULES } from '../../../constants/alertRules';
import { Currency } from '../../../types';
import type { AlertRule } from '../../../types/alertRules';
import type { EnrichedAsset } from '../../../types/ui';
import {
  APP_SELL_RULE_IDS,
  appHighestPrice,
  buildAppIndicatorSeries,
  evaluateAppSellRules,
  type AppSellRuleId,
} from './appRules';
import type { LectureDataset } from './dataAccess';
import { VALIDATION_PERIOD } from './configTypes';

/** 앱 런타임이 실제로 받는 대략적 히스토리 길이(거래일). getRequiredHistoryDaysForOHLCV≈438캘린더일. */
const APP_RUNTIME_WINDOW_BARS = 300;
/** 감사 표본에서 매수단가로 쓸 과거 시점(거래일 전). */
const AUDIT_PURCHASE_LAG = 40;

export interface AuditByRule {
  rule: AppSellRuleId;
  n: number;
  mismatches: number;
  agreement: number;
  appOnly: number; // 앱만 발동
  reproOnly: number; // 재현만 발동
}

export interface AuditResult {
  nStocks: number;
  nSamples: number;
  nComparisons: number;
  totalMismatches: number;
  overallAgreement: number;
  byRule: AuditByRule[];
  windowBars: number;
  windowSensitivity: {
    nComparisons: number;
    mismatches: number;
    mismatchRate: number;
    byRule: Array<{ rule: AppSellRuleId; mismatches: number; rate: number }>;
  };
  /** 불일치 사례 상위 몇 건(디버깅용) */
  samples: Array<{ code: string; date: string; rule: string; app: boolean; repro: boolean }>;
}

/** 앱 규칙 객체(매도·재현대상 13종)를 id 순서로. */
function sellRules(): Array<{ id: AppSellRuleId; rule: AlertRule }> {
  const out: Array<{ id: AppSellRuleId; rule: AlertRule }> = [];
  for (const id of APP_SELL_RULE_IDS) {
    const r = DEFAULT_ALERT_RULES.find((x) => x.id === id);
    if (r) out.push({ id, rule: r });
  }
  return out;
}

/** smartFilterLogic/alertChecker가 참조하는 필드만 채운 pseudo EnrichedAsset(과거 시점). */
function buildPseudoAsset(
  ticker: string,
  close: number,
  changeRate: number,
  purchasePrice: number,
  highestPrice: number
): EnrichedAsset {
  const returnPercentage = purchasePrice > 0 ? ((close - purchasePrice) / purchasePrice) * 100 : 0;
  const dropFromHigh = highestPrice > 0 ? ((close - highestPrice) / highestPrice) * 100 : 0;
  return {
    id: `audit:${ticker}`,
    ticker,
    name: ticker,
    categoryId: 1,
    exchange: '',
    quantity: 1,
    purchasePrice,
    purchaseDate: '',
    currency: Currency.KRW,
    currentPrice: close,
    priceOriginal: close,
    highestPrice,
    changeRate,
    indicators: undefined,
    metrics: {
      purchasePrice,
      currentPrice: close,
      currentPriceKRW: close,
      purchasePriceKRW: purchasePrice,
      purchaseValue: purchasePrice,
      currentValue: close,
      purchaseValueKRW: purchasePrice,
      currentValueKRW: close,
      returnPercentage,
      allocation: 0,
      dropFromHigh,
      profitLoss: close - purchasePrice,
      profitLossKRW: close - purchasePrice,
      diffFromHigh: close - highestPrice,
      yesterdayChange: changeRate * 100,
      diffFromYesterday: 0,
    },
  } as unknown as EnrichedAsset;
}

export interface AuditOptions {
  stocks: number;
  daysPerStock: number;
  seed: number;
}

export function runAppPathAudit(ds: LectureDataset, opt: AuditOptions): AuditResult {
  const rules = sellRules();
  const rng = mulberry32(opt.seed);

  // 충분한 히스토리를 가진 종목만
  const candidates: string[] = [];
  for (const [code, bars] of ds.bars.entries()) {
    if (bars.dates.length >= 800 && bars.dates[0] <= '2014-01-01') candidates.push(code);
  }
  candidates.sort();

  const byRule = new Map<AppSellRuleId, AuditByRule>();
  for (const id of APP_SELL_RULE_IDS) {
    byRule.set(id, { rule: id, n: 0, mismatches: 0, agreement: 1, appOnly: 0, reproOnly: 0 });
  }
  const wsByRule = new Map<AppSellRuleId, { rule: AppSellRuleId; mismatches: number; rate: number }>();
  for (const id of APP_SELL_RULE_IDS) wsByRule.set(id, { rule: id, mismatches: 0, rate: 0 });

  const samples: AuditResult['samples'] = [];
  let nSamples = 0;
  let nComparisons = 0;
  let totalMismatches = 0;
  let wsComparisons = 0;
  let wsMismatches = 0;

  const picked = new Set<string>();
  let guard = 0;
  const stocksUsed: string[] = [];
  while (stocksUsed.length < opt.stocks && guard < 5000 && candidates.length > 0) {
    guard++;
    const code = candidates[Math.floor(rng() * candidates.length)];
    if (picked.has(code)) continue;
    picked.add(code);
    stocksUsed.push(code);
  }

  for (const code of stocksUsed) {
    const bars = ds.bars.get(code);
    if (!bars) continue;
    const series = buildAppIndicatorSeries(bars);
    // 표본기간 안에서만(잠금표본 미개봉)
    let hi = bars.dates.length - 1;
    while (hi >= 0 && bars.dates[hi] > VALIDATION_PERIOD.to) hi--;
    const lo = 400;
    if (hi <= lo + 10) continue;

    for (let k = 0; k < opt.daysPerStock; k++) {
      const i = lo + Math.floor(rng() * (hi - lo + 1));
      const close = bars.adjClose[i];
      const prev = bars.adjClose[i - 1];
      if (!(close > 0) || !(prev > 0)) continue;
      const changeRate = (close - prev) / prev;
      const pIdx = i - AUDIT_PURCHASE_LAG;
      if (pIdx < 0) continue;
      const purchasePrice = bars.adjClose[pIdx];
      if (!(purchasePrice > 0)) continue;
      let runningMax = 0;
      for (let t = pIdx; t <= i; t++) if (bars.adjClose[t] > runningMax) runningMax = bars.adjClose[t];
      const highestPrice = appHighestPrice(series, i, purchasePrice, runningMax);

      const asset = buildPseudoAsset(code, close, changeRate, purchasePrice, highestPrice);

      // ── A. 앱 경로(전 구간 히스토리) ──
      const end = i + 1;
      const enrichedFull = buildEnrichedIndicator({
        sortedDates: bars.dates.slice(0, end) as string[],
        closes: bars.adjClose.slice(0, end) as number[],
        opens: bars.adjOpen.slice(0, end) as number[],
        highs: bars.adjHigh.slice(0, end) as number[],
        lows: bars.adjLow.slice(0, end) as number[],
        volumes: bars.adjVolume.slice(0, end) as number[],
      });

      // ── B. 재현 경로 ──
      const repro = evaluateAppSellRules(series, i, { purchasePrice, highestPrice });

      nSamples++;
      for (const { id, rule } of rules) {
        const app = matchesRule(asset, rule, enrichedFull);
        const rep = repro[id];
        const rec = byRule.get(id)!;
        rec.n++;
        nComparisons++;
        if (app !== rep) {
          rec.mismatches++;
          totalMismatches++;
          if (app) rec.appOnly++;
          else rec.reproOnly++;
          if (samples.length < 30) {
            samples.push({ code, date: bars.dates[i], rule: id, app, repro: rep });
          }
        }
      }

      // ── C. 히스토리 길이 민감도(앱 런타임 창) ──
      const wStart = Math.max(0, end - APP_RUNTIME_WINDOW_BARS);
      const enrichedWin = buildEnrichedIndicator({
        sortedDates: bars.dates.slice(wStart, end) as string[],
        closes: bars.adjClose.slice(wStart, end) as number[],
        opens: bars.adjOpen.slice(wStart, end) as number[],
        highs: bars.adjHigh.slice(wStart, end) as number[],
        lows: bars.adjLow.slice(wStart, end) as number[],
        volumes: bars.adjVolume.slice(wStart, end) as number[],
      });
      for (const { id, rule } of rules) {
        const full = matchesRule(asset, rule, enrichedFull);
        const win = matchesRule(asset, rule, enrichedWin);
        wsComparisons++;
        if (full !== win) {
          wsMismatches++;
          wsByRule.get(id)!.mismatches++;
        }
      }
    }
  }

  const byRuleOut = APP_SELL_RULE_IDS.map((id) => {
    const r = byRule.get(id)!;
    return { ...r, agreement: r.n > 0 ? 1 - r.mismatches / r.n : 1 };
  });
  const wsOut = APP_SELL_RULE_IDS.map((id) => {
    const r = wsByRule.get(id)!;
    return { rule: id, mismatches: r.mismatches, rate: nSamples > 0 ? r.mismatches / nSamples : 0 };
  });

  return {
    nStocks: stocksUsed.length,
    nSamples,
    nComparisons,
    totalMismatches,
    overallAgreement: nComparisons > 0 ? 1 - totalMismatches / nComparisons : 1,
    byRule: byRuleOut,
    windowBars: APP_RUNTIME_WINDOW_BARS,
    windowSensitivity: {
      nComparisons: wsComparisons,
      mismatches: wsMismatches,
      mismatchRate: wsComparisons > 0 ? wsMismatches / wsComparisons : 0,
      byRule: wsOut,
    },
    samples,
  };
}
