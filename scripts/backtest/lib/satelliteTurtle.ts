// scripts/backtest/lib/satelliteTurtle.ts
// 위성(투더문) 터틀 시뮬레이터 — 앱의 utils/turtleEngine.ts, utils/donchianChannel.ts 순수 함수를 그대로 재사용.
//
// 체결가 규칙(일봉 근사, 룩어헤드 0 — 스펙 §체결 규칙)은 앱 엔진에 없는 부분이라 여기서 구현한다:
//   진입 fill = max(open[t], entryHigh) / 청산 fill = min(open[t], exitLow) /
//   손절 fill = min(open[t], stopPrice) / 피라미딩 fill = max(open[t], trigger).
// 피라미딩 트리거(lastFill + pyramidStepN×N) 자체는 evaluatePyramid 내부에도 있지만 그 함수는
// "트리거 판정"과 "체결가 기준 사이징"을 같은 price 인자 하나로 합쳐 받는다. 여기서는 high[t]로
// 트리거 돌파 여부를 먼저 판정(장중 터치)하고, 실제 체결가(fillPrice)로 다시 evaluatePyramid를 호출해
// 사이징한다 — 그러려면 트리거 값 자체가 먼저 필요해 한 줄만 동일 공식으로 재계산한다(주석 명시).

import {
  evaluateEntry,
  evaluatePyramid,
  evaluateStop,
  evaluateExit,
  computeN,
  computeTotalOpenRisk,
  positionQuantity,
} from '../../../utils/turtleEngine';
import { firstValidIndex } from './calendar';
import { buildDonchianChannels } from '../../../utils/donchianChannel';
import { TurtlePosition, TurtleSettings, TurtleUnit } from '../../../types/turtle';
import { ClosedTrade } from './metrics';

export interface SatelliteAssetSeries {
  ticker: string;
  name: string;
  currency: string;
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  fxRate: (number | null)[]; // 캘린더 정렬 (KRW=1)
  allowFractional: boolean; // 암호화폐 등 소수 수량 허용
}

export interface SatelliteRuleConfig {
  maxUnitsPerPosition: number;
  entryLookback: number;
  exitLookback: number;
  stopMultipleN: number;
  pyramidStepN: number;
  riskPerUnitPct: number;
  maxTotalRiskPct: number;
  positionValueCapPct: number;
  costRate: number; // 편도 (예: 0.001)
}

interface OpenCostBasis {
  investedKRW: number; // 진입 체결가치(KRW) + 진입 비용 누적
}

export class SatelliteTurtleSim {
  cashKRW = 0;
  private positions = new Map<string, TurtlePosition>();
  private costBasis = new Map<string, OpenCostBasis>();
  trades: ClosedTrade[] = [];
  private nextPositionId = 1;
  // 사이징 기준 예산(스펙: "위성 예산(수동 입력)" — 매 틱 실시간 평가액이 아니라 반기 리밸런싱 시점에만 갱신).
  // 매일 currentValueKRW()로 계속 갱신하면 같은 추세를 타는 포지션의 미실현 평가익이 그날그날 자기
  // 자신의 다음 피라미딩 사이징을 부풀리는 반사(reflexive) 루프가 생겨 몇 달 만에 계좌가 비현실적으로
  // 폭발한다(검증 중 실제로 관측 — BTC 한 트레이드가 수백조 원 손익을 내는 등). 반기 리밸런싱 때만
  // 갱신해 "그 반기 동안의 자산 규모 대비 리스크"라는 터틀 원 의도를 유지한다.
  private referenceBudgetKRW = 0;
  // 종목별 첫 유효 데이터 인덱스 (상장 전 구간). ATR(N) 계산은 절대 배열 시작(0)이 아니라
  // 이 인덱스부터 슬라이스해야 한다 — calculateATR(utils/maCalculations.ts)은 워밍업 윈도우
  // (첫 period개)에 null이 하나라도 있으면 그 뒤로 아무리 데이터가 쌓여도 영구히 null을 반환한다
  // (버그, 앱 코드라 이 스크립트에서 수정 불가 — 대신 여기서 상장일부터 슬라이스해 우회한다).
  private readonly firstValidIdx: Map<string, number>;

  constructor(private assets: SatelliteAssetSeries[], private rules: SatelliteRuleConfig) {
    this.firstValidIdx = new Map(assets.map(a => [a.ticker, Math.max(0, firstValidIndex(a.close))]));
  }

  /** 반기 리밸런싱 시점에만 호출 — 사이징 기준 예산을 그 시점의 평가액으로 갱신. */
  setReferenceBudget(valueKRW: number): void {
    this.referenceBudgetKRW = Math.max(0, valueKRW);
  }

  /** 외부 자금 유출입 (코어↔위성 비율 리밸런싱). 인출 시 보유현금 초과분은 클램프. */
  applyExternalFlow(amount: number): void {
    if (amount >= 0) {
      this.cashKRW += amount;
    } else {
      const withdraw = Math.min(this.cashKRW, -amount);
      this.cashKRW -= withdraw;
    }
  }

  currentValueKRW(t: number): number {
    let sum = this.cashKRW;
    for (const a of this.assets) {
      const pos = this.positions.get(a.ticker);
      if (!pos || pos.status !== 'open') continue;
      const price = a.close[t];
      const fx = a.fxRate[t] ?? 1;
      if (typeof price === 'number') sum += positionQuantity(pos) * price * fx;
    }
    return sum;
  }

  private fxAt(a: SatelliteAssetSeries, t: number): number {
    return a.fxRate[t] ?? 1;
  }

  private settingsAt(_t: number): TurtleSettings {
    return {
      satelliteBudgetKRW: this.referenceBudgetKRW,
      riskPerUnitPct: this.rules.riskPerUnitPct,
      maxUnitsPerPosition: this.rules.maxUnitsPerPosition,
      entryLookback: this.rules.entryLookback,
      exitLookback: this.rules.exitLookback,
      stopMultipleN: this.rules.stopMultipleN,
      pyramidStepN: this.rules.pyramidStepN,
      maxTotalRiskPct: this.rules.maxTotalRiskPct,
      positionValueCapPct: this.rules.positionValueCapPct,
      drawdownScalingEnabled: false, // 백테스트 A~D는 드로다운 감쇄 밖의 구조 비교 — 스펙에 없어 기본 미적용
    };
  }

  /** 하루치 진행: 손절 → 청산 → 피라미딩/신규진입 순으로 종목별 1건만 처리. */
  advanceDay(t: number, date: string): void {
    const openPositions: TurtlePosition[] = Array.from(this.positions.values()).filter(p => p.status === 'open');
    const settings = this.settingsAt(t);
    const getFx = (p: TurtlePosition) => {
      const a = this.assets.find(x => x.ticker === p.ticker);
      return a ? this.fxAt(a, t) : 1;
    };

    for (const a of this.assets) {
      const pos = this.positions.get(a.ticker);
      const open = a.open[t];
      const high = a.high[t];
      const low = a.low[t];
      if (open === null || high === null || low === null) continue;
      const fx = this.fxAt(a, t);

      if (pos && pos.status === 'open') {
        // 손절 우선
        const stopHit = evaluateStop(pos, low);
        if (stopHit) {
          const fillPrice = Math.min(open, pos.stopPrice);
          this.closePosition(pos, fillPrice, fx, date, 'stop');
          continue;
        }
        // 청산 (20일 신저가)
        const channels = buildDonchianChannels(
          a.high.slice(0, t + 1),
          a.low.slice(0, t + 1),
          a.close.slice(0, t + 1),
          this.rules.entryLookback,
          this.rules.exitLookback
        );
        const exitHit = evaluateExit(pos, channels.exitLow, low);
        if (exitHit) {
          const fillPrice = Math.min(open, channels.exitLow as number);
          this.closePosition(pos, fillPrice, fx, date, 'channel-exit');
          continue;
        }
        // 피라미딩 (여력 있을 때만)
        if (pos.units.length < this.rules.maxUnitsPerPosition) {
          const startIdx = this.firstValidIdx.get(a.ticker) ?? 0;
          const n = computeN(a.high.slice(startIdx, t), a.low.slice(startIdx, t), a.close.slice(startIdx, t));
          if (n !== null) {
            const lastUnit = pos.units[pos.units.length - 1];
            // 트리거 재계산: evaluatePyramid와 동일 공식 (high[t]로 장중 터치 여부만 선판정 — 재사용 API 제약, 상단 주석 참조)
            const trigger = lastUnit.fillPrice + this.rules.pyramidStepN * n;
            if (high >= trigger) {
              const fillPrice = Math.max(open, trigger);
              const proposal = evaluatePyramid(pos, fillPrice, n, settings, {
                allowFractional: a.allowFractional,
                fxRate: fx,
              });
              if (proposal) {
                this.fillPyramid(pos, proposal, fillPrice, n, fx, date);
              }
            }
          }
        }
        continue;
      }

      // 포지션 없음 → 신규 진입 판정
      const channels = buildDonchianChannels(
        a.high.slice(0, t + 1),
        a.low.slice(0, t + 1),
        a.close.slice(0, t + 1),
        this.rules.entryLookback,
        this.rules.exitLookback
      );
      if (channels.entryHigh === null || !(high > channels.entryHigh)) continue;
      const startIdxEntry = this.firstValidIdx.get(a.ticker) ?? 0;
      const n = computeN(a.high.slice(startIdxEntry, t), a.low.slice(startIdxEntry, t), a.close.slice(startIdxEntry, t));
      if (n === null) continue;
      const fillPrice = Math.max(open, channels.entryHigh);
      const totalRisk = computeTotalOpenRisk(openPositions, settings, getFx);
      const decision = evaluateEntry({
        ticker: a.ticker,
        name: a.name,
        price: fillPrice,
        n,
        donchianHigh: channels.entryHigh,
        settings,
        openRiskKRW: totalRisk.riskKRW,
        remainingBudgetKRW: this.cashKRW,
        fxRate: fx,
        allowFractional: a.allowFractional,
      });
      if (decision.ok && decision.proposal) {
        this.openPosition(a, decision.proposal, fillPrice, n, fx, date);
      }
    }
  }

  private tradeCostKRW(qty: number, price: number, fx: number): number {
    return qty * price * fx * this.rules.costRate;
  }

  private openPosition(
    a: SatelliteAssetSeries,
    proposal: { quantity: number; stopPrice: number; donchianHigh: number },
    fillPrice: number,
    n: number,
    fx: number,
    date: string
  ): void {
    const notionalKRW = proposal.quantity * fillPrice * fx;
    const costKRW = this.tradeCostKRW(proposal.quantity, fillPrice, fx);
    if (notionalKRW + costKRW > this.cashKRW + 1e-6) return; // 안전장치 (evaluateEntry가 이미 걸렀어야 함)

    const unit: TurtleUnit = { fillDate: date, fillPrice, quantity: proposal.quantity, nAtFill: n, fxRateAtFill: fx };
    const position: TurtlePosition = {
      id: `pos-${this.nextPositionId++}`,
      ticker: a.ticker,
      name: a.name,
      units: [unit],
      stopPrice: proposal.stopPrice,
      entryDonchianHigh: proposal.donchianHigh,
      status: 'open',
      openedAt: date,
    };
    this.positions.set(a.ticker, position);
    this.costBasis.set(a.ticker, { investedKRW: notionalKRW + costKRW });
    this.cashKRW -= notionalKRW + costKRW;
  }

  private fillPyramid(
    pos: TurtlePosition,
    proposal: { quantity: number; newStopPrice: number },
    fillPrice: number,
    n: number,
    fx: number,
    date: string
  ): void {
    const notionalKRW = proposal.quantity * fillPrice * fx;
    const costKRW = this.tradeCostKRW(proposal.quantity, fillPrice, fx);
    if (notionalKRW + costKRW > this.cashKRW + 1e-6) return;

    pos.units.push({ fillDate: date, fillPrice, quantity: proposal.quantity, nAtFill: n, fxRateAtFill: fx });
    pos.stopPrice = proposal.newStopPrice;
    const basis = this.costBasis.get(pos.ticker);
    if (basis) basis.investedKRW += notionalKRW + costKRW;
    this.cashKRW -= notionalKRW + costKRW;
  }

  private closePosition(
    pos: TurtlePosition,
    fillPrice: number,
    fx: number,
    date: string,
    reason: 'stop' | 'channel-exit'
  ): void {
    const qty = positionQuantity(pos);
    const proceedsKRW = qty * fillPrice * fx;
    const costKRW = this.tradeCostKRW(qty, fillPrice, fx);
    const netProceeds = proceedsKRW - costKRW;
    const basis = this.costBasis.get(pos.ticker);
    const investedKRW = basis ? basis.investedKRW : netProceeds;

    this.cashKRW += netProceeds;
    pos.status = 'closed';
    pos.closedAt = date;
    pos.exitReason = reason;
    this.positions.delete(pos.ticker);
    this.costBasis.delete(pos.ticker);

    this.trades.push({
      ticker: pos.ticker,
      openDate: pos.openedAt,
      closeDate: date,
      pnlKRW: netProceeds - investedKRW,
    });
  }
}
