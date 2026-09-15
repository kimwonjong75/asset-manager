// components/replay/ReplayPerformancePanel.tsx
// 규칙별 누적 성과(③, 렌더 전용) — 현재 윈도에서 각 규칙이 몇 번 발화했고 신호 후 평균 성과/적중률이
// 어땠는지 표로 보여준다. 집계는 utils/replayPerformance(순수). 성과는 미래 종가 기반 복기치(신호 계산 무관).

import React from 'react';
import { ChartColumn } from 'lucide-react';
import type { SignalPerformance } from '../../utils/replayPerformance';
import { directionTextClass, tradeSideTextClass } from '../../utils/directionTone';

const pct = (v: number | null): string => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
const rate = (v: number | null): string => (v == null ? '—' : `${Math.round(v * 100)}%`);

const ReplayPerformancePanel: React.FC<{ performance: SignalPerformance[] }> = ({ performance }) => {
  return (
    <div className="bg-surface-elevated border border-border-subtle rounded-card p-3">
      <h3 className="text-base font-semibold text-white mb-1 flex items-center gap-1.5 flex-wrap">
        <ChartColumn className="h-4 w-4 text-gray-400" aria-hidden="true" />
        규칙별 성과 <span className="text-xs text-gray-500 font-normal">— 이 기간 신호의 복기 결과(미래 종가 기반)</span>
      </h3>
      {performance.length === 0 ? (
        <p className="text-xs text-gray-500">이 기간에 발화한 규칙이 없습니다. 더 긴 기간을 선택하거나 다른 종목을 시도해 보세요.</p>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-2">
            적중률 = 신호 방향대로 움직인 비율(매수=20일 후 상승 / 매도=20일 후 하락). 괄호는 평가 가능한 표본 수 — 적으면 신뢰도 낮음.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 text-left">
                  <th className="font-normal py-1 pr-2">규칙</th>
                  <th className="font-normal py-1 px-1 text-right whitespace-nowrap">발화</th>
                  <th className="font-normal py-1 px-1 text-right whitespace-nowrap">적중률</th>
                  <th className="font-normal py-1 px-1 text-right whitespace-nowrap">평균 20일</th>
                  <th className="font-normal py-1 pl-1 text-right whitespace-nowrap">최대 상승/하락</th>
                </tr>
              </thead>
              <tbody>
                {performance.map(p => (
                  <tr key={p.key} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-2">
                      <span className="text-xs mr-1 px-1 rounded whitespace-nowrap bg-surface-muted border border-border-subtle text-gray-300">
                        {p.kind === 'guru' ? '구루' : '알림'}
                      </span>
                      <span className={`text-xs mr-1 ${tradeSideTextClass(p.action === 'sell' ? 'sell' : 'buy')}`}>
                        {p.action === 'sell' ? '매도' : '매수'}
                      </span>
                      <span className="text-gray-200">{p.label}</span>
                    </td>
                    <td className="py-1.5 px-1 text-right font-mono text-gray-300">{p.signalCount}</td>
                    <td className="py-1.5 px-1 text-right font-mono text-gray-200">
                      {rate(p.hitRate20)} <span className="text-gray-500">({p.evaluable20})</span>
                    </td>
                    <td className={`py-1.5 px-1 text-right font-mono ${directionTextClass(p.avgRet20)}`}>
                      {pct(p.avgRet20)}
                    </td>
                    <td className="py-1.5 pl-1 text-right font-mono whitespace-nowrap">
                      <span className="text-up">{pct(p.avgMaxRise)}</span>
                      <span className="text-gray-500"> / </span>
                      <span className="text-down">{pct(p.avgMaxDrop)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default ReplayPerformancePanel;
