// components/replay/ReplayMissedPanel.tsx
// 놓친 매수/매도 모아보기(④, 렌더 전용) — 전 종목의 missed-buy/missed-sell 판정을 종목별로 묶어
// "앱이 못 잡은 자리" 목록을 보여준다. 클릭 시 해당 종목+시점으로 점프(현재 종목이거나 퀵픽에 있을 때).
// 데이터는 훅의 missedVerdicts(localStorage 판정에서 파생). 저장/이동 로직은 훅이 담당.

import React, { useMemo } from 'react';
import type { SignalVerdict } from '../../types/signalReplay';
import { VERDICT_KIND_LABELS } from './ReplayVerdictPanel';

interface ReplayMissedPanelProps {
  missed: SignalVerdict[];
  currentTicker: string | null;
  resolvable: (ticker: string) => boolean; // 퀵픽(보유/관심)에 있어 로드 가능한가
  onJump: (v: SignalVerdict) => void;
}

const ReplayMissedPanel: React.FC<ReplayMissedPanelProps> = ({ missed, currentTicker, resolvable, onJump }) => {
  // 종목별 그룹(건수 많은 순) — "어떤 종목에서 자주 놓치나" 패턴 확인용.
  const groups = useMemo(() => {
    const m = new Map<string, SignalVerdict[]>();
    for (const v of missed) {
      const arr = m.get(v.ticker) ?? [];
      arr.push(v);
      m.set(v.ticker, arr);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [missed]);

  return (
    <div className="bg-gray-800 rounded-lg p-3">
      <h3 className="text-sm font-bold text-white mb-1">
        🕳️ 놓친 매수/매도 모아보기 <span className="text-[11px] text-gray-500 font-normal">— 앱이 침묵한 자리</span>
      </h3>
      <p className="text-[11px] text-gray-600 mb-2">
        “명백한 기회인데 신호가 없던 날” 기록입니다. 쌓일수록 앱이 놓치는 패턴이 드러납니다(개선 1순위 단서).
      </p>
      {missed.length === 0 ? (
        <p className="text-xs text-gray-500">아직 없습니다. 복기 중 신호 없는 명백한 자리에서 ‘놓친 매수/매도’로 기록해 보세요.</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {groups.map(([ticker, vs]) => {
            const canJump = currentTicker === ticker || resolvable(ticker);
            return (
              <div key={ticker}>
                <div className="text-[11px] text-gray-400 font-mono mb-0.5">
                  {ticker} <span className="text-gray-600">· {vs.length}건</span>
                  {!canJump && <span className="text-gray-700 ml-1">(목록에 없어 점프 불가)</span>}
                </div>
                <ul className="space-y-1">
                  {vs.map(v => (
                    <li
                      key={`${v.date}-${v.ruleId ?? ''}`}
                      onClick={() => canJump && onJump(v)}
                      className={`flex items-center gap-2 text-[11px] rounded px-2 py-1 ${
                        canJump ? 'cursor-pointer hover:bg-gray-700/40 bg-gray-900/40' : 'bg-gray-900/20 cursor-default'
                      }`}
                    >
                      <span className="font-mono text-gray-300 whitespace-nowrap">{v.date}</span>
                      <span className="text-sky-300 whitespace-nowrap">{VERDICT_KIND_LABELS[v.kind]}</span>
                      {v.memo && <span className="text-gray-500 truncate flex-1">{v.memo}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ReplayMissedPanel;
