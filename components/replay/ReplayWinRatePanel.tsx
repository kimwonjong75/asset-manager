// components/replay/ReplayWinRatePanel.tsx
// 손익비×승률 진단(렌더 전용) — 현재 종목·기간 판정(verdict)을 승/패로 분류해 실현 승률·손익비·손익분기 승률·
// 기대값을 보여준다. 계산은 utils/winRateDiagnostics(순수, 훅이 timeline outcome 과 조인). 지식 근거:
// `low-winrate-high-payoff`(강환국, 3할 타자론) — "손익분기 승률 = 1/(1+손익비)"를 사용자 판정으로 화면에 닫음.
//
// ★ 소표본 주의: 판정은 수작업·localStorage·소표본이라 "승률 100%(2건)" 착시가 쉽다 → N 표시 + N<10 경고를
//   전면에 둔다. 손익비 산출 불가(승·패 한쪽 표본 없음)면 배지를 숨기고 사유를 명시(거짓 수익권 방지).

import React from 'react';
import { MIN_RELIABLE_SAMPLE, type WinRateDiagnostics } from '../../utils/winRateDiagnostics';

const pctRate = (v: number | null): string => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const pctMag = (v: number | null): string => (v == null ? '—' : `${v.toFixed(2)}%`);
const ratio = (v: number | null): string => (v == null ? '—' : `${v.toFixed(2)} : 1`);
const signed = (v: number | null): string => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);

const EDGE: Record<'profitable' | 'breakeven' | 'losing', { label: string; cls: string }> = {
  profitable: { label: '수익권 (승률 > 손익분기)', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  breakeven: { label: '손익분기 (승률 = 손익분기)', cls: 'bg-gray-500/15 text-gray-300 border-gray-500/40' },
  losing: { label: '손실권 (승률 < 손익분기)', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
};

const Stat: React.FC<{ label: string; value: string; valueClass?: string; sub?: string }> = ({
  label, value, valueClass = 'text-white', sub,
}) => (
  <div className="bg-gray-900/50 rounded px-2.5 py-2">
    <div className="text-gray-500 text-[10px]">{label}</div>
    <div className={`font-mono text-sm ${valueClass}`}>{value}</div>
    {sub && <div className="text-gray-600 text-[10px] mt-0.5">{sub}</div>}
  </div>
);

const ReplayWinRatePanel: React.FC<{ diag: WinRateDiagnostics }> = ({ diag }) => {
  const edge = diag.edge ? EDGE[diag.edge] : null;

  return (
    <div className="bg-gray-800 rounded-lg p-3">
      <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2 flex-wrap">
        🎯 손익비 × 승률 진단
        <span className="text-[11px] text-gray-500 font-normal">— 이 종목·이 기간 내 판정 기준(실현 복기)</span>
        {edge && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${edge.cls}`}>{edge.label}</span>
        )}
      </h3>

      {diag.n === 0 ? (
        <p className="text-xs text-gray-500">
          이 기간에 분류된 판정이 없습니다. 차트에서 날짜를 골라 신호를 <span className="text-gray-400">적절/잘못/늦음/빠름</span>으로
          판정하면 실현 승률·손익비가 집계됩니다. (놓친 매수/매도는 표본에서 제외)
        </p>
      ) : (
        <>
          {diag.smallSample && (
            <p className="text-[11px] text-amber-400/90 mb-2">
              ⚠ 표본 {diag.n}건 — {MIN_RELIABLE_SAMPLE}건 미만은 우연일 수 있습니다(예: “승률 100%(2건)” 착시). 더 많은 판정을 쌓으세요.
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat
              label="실현 승률"
              value={pctRate(diag.winRate)}
              sub={`표본 ${diag.n}건 (승 ${diag.wins} · 패 ${diag.losses})`}
            />
            <Stat
              label="손익비 (평균이익÷평균손실)"
              value={ratio(diag.payoff)}
              valueClass={diag.payoff != null ? 'text-white' : 'text-gray-500'}
              sub={diag.payoff == null ? '승·패 양쪽 수익률 표본 필요' : undefined}
            />
            <Stat
              label="손익분기 승률 = 1/(1+손익비)"
              value={pctRate(diag.breakevenWinRate)}
              valueClass={diag.breakevenWinRate != null ? 'text-sky-300' : 'text-gray-500'}
            />
            <Stat
              label="평균 이익 (|수익률|)"
              value={pctMag(diag.avgWinPct)}
              valueClass="text-emerald-400"
              sub={`${diag.winsWithReturn}건 평균`}
            />
            <Stat
              label="평균 손실 (|수익률|)"
              value={pctMag(diag.avgLossPct)}
              valueClass="text-rose-400"
              sub={`${diag.lossesWithReturn}건 평균`}
            />
            <Stat
              label="기대값 (1거래당)"
              value={signed(diag.expectancy)}
              valueClass={
                diag.expectancy == null ? 'text-gray-500' : diag.expectancy >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }
            />
          </div>

          {diag.excludedMissed > 0 && (
            <p className="text-[11px] text-gray-600 mt-2">
              놓친 매수/매도 {diag.excludedMissed}건은 “잡은 거래”가 아니라 승률 표본에서 제외했습니다(아래 ‘놓친 신호’ 참고).
            </p>
          )}

          <p className="text-[11px] text-gray-600 mt-2 pt-2 border-t border-gray-700/40">
            💡 강환국 “3할 타자론”: 승률이 낮아도 <span className="text-gray-400">손익비가 손익분기(1/(1+손익비))를 넘으면 수익</span>입니다.
            셋업(&lt;40%)은 2:1로 충분하나 쿨라매기(25~30%)는 3:1급이 필요합니다. 크기는 신호 후 20거래일 |수익률| 기준(복기치).
          </p>
        </>
      )}
    </div>
  );
};

export default ReplayWinRatePanel;
