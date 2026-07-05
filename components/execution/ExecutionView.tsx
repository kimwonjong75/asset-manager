// components/execution/ExecutionView.tsx
// ---------------------------------------------------------------------------
// "오늘의 주문서" 실행 큐 화면 (Phase 2b-3).
//
// 범위(Codex 리뷰): 큐 UI + 상태 전환(done/skip/snooze)까지만.
//   · **화면 진입 자동 refresh 금지** — "오늘 주문 생성" 버튼을 눌렀을 때만 refreshActionQueue().
//   · **건너뜀 사유 필수** — 빈 사유로 skipped 저장 불가 (인라인 textarea).
//   · 터틀 kind(TURTLE_*)의 "실행 완료"는 전용 TurtleExecuteModal을 연다 (Phase 2b-4b-2-ii) —
//     모달 저장 성공 시에만 done+lifecycle 커밋. 비터틀 kind는 기존 markDone(표시만) 유지.
//   · TurtleExecuteModal에 executeTurtleAction을 **prop으로 전달** — useActionQueue 인스턴스 중복 방지.
// UI 렌더만 담당(프로젝트 규칙) — 계산/상태는 useActionQueue 훅.

import React, { useMemo, useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useActionQueue } from '../../hooks/useActionQueue';
import { ActionItem, ActionKind, isActiveAction } from '../../types/actionQueue';
import { actionDaysIgnored, actionEscalationLevel } from '../../utils/actionQueueGenerator';
import TurtleExecuteModal from './TurtleExecuteModal';
import TurtleSettingsPanel from './TurtleSettingsPanel';
import WhyNoOrderPanel from './WhyNoOrderPanel';
import CleanupExecuteModal from '../cleanup/CleanupExecuteModal';
import RebalanceExecuteModal from '../dashboard/RebalanceExecuteModal';
import type { RefreshDiagnostics } from '../../types/actionQueue';

/** 전용 실행 모달을 여는 터틀 kind (진입/불타기/손절/청산). 나머지는 표시만 완료(markDone). */
const TURTLE_KINDS: ActionKind[] = ['TURTLE_ENTRY', 'TURTLE_PYRAMID', 'TURTLE_STOP', 'TURTLE_EXIT'];
const isTurtleKind = (kind: ActionKind): boolean => TURTLE_KINDS.includes(kind);
/** 전용 청산 실행 모달을 여는 kind (대청소). */
const isCleanupKind = (kind: ActionKind): boolean => kind === 'CLEANUP_SELL';
/** 전용 리밸런싱 실행 모달을 여는 kind (Phase 4c-2). */
const isRebalanceKind = (kind: ActionKind): boolean => kind === 'REBALANCE_BUY' || kind === 'REBALANCE_SELL';
/** 전용 실행 모달이 필요한 kind (일반 markDone과 분리) — 완료 버튼 라벨 '실행하기'. */
const needsExecuteModal = (kind: ActionKind): boolean => isTurtleKind(kind) || isCleanupKind(kind) || isRebalanceKind(kind);

const KIND_META: Record<ActionKind, { label: string; dot: string; badge: string }> = {
  TURTLE_ENTRY:   { label: '신규 매수', dot: 'bg-emerald-400', badge: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' },
  TURTLE_PYRAMID: { label: '불타기 추가', dot: 'bg-sky-400', badge: 'text-sky-300 border-sky-500/40 bg-sky-500/10' },
  TURTLE_STOP:    { label: '손절 매도', dot: 'bg-red-400', badge: 'text-red-300 border-red-500/40 bg-red-500/10' },
  TURTLE_EXIT:    { label: '청산 매도', dot: 'bg-orange-400', badge: 'text-orange-300 border-orange-500/40 bg-orange-500/10' },
  REBALANCE_SELL: { label: '리밸런싱 매도', dot: 'bg-amber-400', badge: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
  REBALANCE_BUY:  { label: '리밸런싱 매수', dot: 'bg-teal-400', badge: 'text-teal-300 border-teal-500/40 bg-teal-500/10' },
  CLEANUP_SELL:   { label: '대청소 정리', dot: 'bg-gray-400', badge: 'text-gray-300 border-gray-500/40 bg-gray-500/10' },
};

const fmt = (n: number): string =>
  Number.isFinite(n) ? n.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) : '—';

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const ExecutionView: React.FC = () => {
  const { actions } = usePortfolio();
  const { actionQueue, refreshActionQueue, markDone, markSkipped, snoozeAction, executeTurtleAction, executeCleanupAction, executeRebalanceAction, isRefreshing, refreshError } = useActionQueue();
  const today = todayISO();

  const [skipId, setSkipId] = useState<string | null>(null);
  const [skipText, setSkipText] = useState('');
  const [lastResult, setLastResult] = useState<string | null>(null);
  // 마지막 "오늘 주문 생성" 결과가 0건일 때만 진단 노출 (생성됐으면 null로 숨김)
  const [noOrderDiag, setNoOrderDiag] = useState<RefreshDiagnostics | null>(null);

  const { active, resolvedCount } = useMemo(() => {
    const act = actionQueue.filter(it => isActiveAction(it.status));
    // 에스컬레이션 높은 순 → 오래된 순
    act.sort((a, b) => {
      const ea = actionEscalationLevel(a, today), eb = actionEscalationLevel(b, today);
      if (ea !== eb) return eb - ea;
      return a.createdDate.localeCompare(b.createdDate);
    });
    return { active: act, resolvedCount: actionQueue.length - act.length };
  }, [actionQueue, today]);

  const handleRefresh = async () => {
    const { generated, diagnostics } = await refreshActionQueue();
    setLastResult(generated > 0 ? `${generated}건의 새 주문이 생성되었습니다.` : '새로 생성된 주문이 없습니다.');
    setNoOrderDiag(generated > 0 ? null : diagnostics);
  };

  const startSkip = (id: string) => { setSkipId(id); setSkipText(''); };
  const confirmSkip = () => {
    if (skipId && skipText.trim()) { markSkipped(skipId, skipText); setSkipId(null); setSkipText(''); }
  };

  return (
    <div className="max-w-3xl mx-auto px-1 sm:px-0 pb-16">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-white">오늘의 주문서</h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">
            터틀 규칙이 만든 실행 목록입니다. 판단은 규칙이 하고, 당신은 <span className="text-gray-200">실행 · 건너뜀 · 내일</span>만 고르면 됩니다.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex-shrink-0 flex items-center gap-1.5 text-xs sm:text-sm font-medium text-white bg-primary hover:bg-primary-dark px-3 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="지금 터틀 규칙을 평가해 오늘 주문을 생성합니다 (화면 진입만으로는 생성되지 않습니다)"
        >
          {isRefreshing ? (
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 4l1.5 1.5A9 9 0 0120.5 10M20 20l-1.5-1.5A9 9 0 003.5 14" />
            </svg>
          )}
          <span>{isRefreshing ? '생성 중...' : '오늘 주문 생성'}</span>
        </button>
      </div>

      {/* 터틀(위성) 예산 설정 — 예산 0이면 진입 주문이 생성되지 않으므로 상단 노출 */}
      <TurtleSettingsPanel />

      {/* 상태 요약 */}
      <div className="flex items-center gap-3 text-xs text-gray-400 mb-3">
        <span>대기 <span className="text-gray-100 font-semibold">{active.length}</span>건</span>
        <span className="text-gray-600">·</span>
        <span>처리됨 {resolvedCount}건</span>
        {lastResult && <span className="text-gray-500">· {lastResult}</span>}
      </div>

      {refreshError && (
        <div className="mb-3 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{refreshError}</div>
      )}

      {/* 0건일 때 "왜 주문이 없나요?" 진단 */}
      {noOrderDiag && <WhyNoOrderPanel diagnostics={noOrderDiag} />}

      {/* 주문 카드 목록 */}
      {active.length === 0 ? (
        <div className="text-center text-gray-500 bg-gray-800/50 border border-gray-700 rounded-lg py-12 px-4">
          <p className="text-sm">대기 중인 주문이 없습니다.</p>
          <p className="text-xs mt-1">「오늘 주문 생성」을 눌러 터틀 규칙을 평가하세요.</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {active.map(item => (
            <ActionCard
              key={item.id}
              item={item}
              today={today}
              isSkipping={skipId === item.id}
              skipText={skipText}
              onSkipTextChange={setSkipText}
              onStartSkip={() => startSkip(item.id)}
              onConfirmSkip={confirmSkip}
              onCancelSkip={() => setSkipId(null)}
              onDone={() =>
                isTurtleKind(item.kind) ? actions.openTurtleExecution(item)
                : isCleanupKind(item.kind) ? actions.openCleanupExecution(item)
                : isRebalanceKind(item.kind) ? actions.openRebalanceExecution(item)
                : markDone(item.id)}
              isTurtle={needsExecuteModal(item.kind)}
              onSnooze={() => snoozeAction(item.id, 1)}
            />
          ))}
        </ul>
      )}

      {/* 실행 모달 — 각 executeXxxAction을 prop으로 전달(훅 인스턴스 중복 방지) */}
      <TurtleExecuteModal executeTurtleAction={executeTurtleAction} />
      <CleanupExecuteModal executeCleanupAction={executeCleanupAction} />
      <RebalanceExecuteModal executeRebalanceAction={executeRebalanceAction} />
    </div>
  );
};

interface ActionCardProps {
  item: ActionItem;
  today: string;
  isSkipping: boolean;
  skipText: string;
  onSkipTextChange: (v: string) => void;
  onStartSkip: () => void;
  onConfirmSkip: () => void;
  onCancelSkip: () => void;
  onDone: () => void;
  isTurtle: boolean;
  onSnooze: () => void;
}

const ActionCard: React.FC<ActionCardProps> = ({
  item, today, isSkipping, skipText, onSkipTextChange, onStartSkip, onConfirmSkip, onCancelSkip, onDone, isTurtle, onSnooze,
}) => {
  const meta = KIND_META[item.kind];
  const level = actionEscalationLevel(item, today);
  const days = actionDaysIgnored(item, today);
  const ring = level === 2 ? 'border-red-500/60 ring-1 ring-red-500/40' : level === 1 ? 'border-amber-500/50' : 'border-gray-700';

  return (
    <li className={`bg-gray-800 border ${ring} rounded-lg p-3.5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />{meta.label}
            </span>
            <span className="text-white font-semibold truncate">{item.name}</span>
            <span className="text-xs text-gray-500">{item.ticker}</span>
            {item.status === 'snoozed' && (
              <span className="text-[11px] text-gray-400 bg-gray-700/60 px-1.5 py-0.5 rounded">내일 다시</span>
            )}
          </div>
          <p className="text-sm text-gray-300 mt-1.5">{item.reasonText}</p>
          <div className="flex items-center gap-3 text-xs text-gray-400 mt-1.5">
            <span>수량 <span className="text-gray-200 font-medium">{fmt(item.quantity)}</span></span>
            <span>기준가 <span className="text-gray-200 font-medium">{fmt(item.refPrice)}</span></span>
            {days > 0 && (
              <span className={level >= 1 ? 'text-amber-300 font-medium' : ''}>
                {level === 2 ? '⚠ ' : ''}{days}일째 미실행
              </span>
            )}
          </div>
        </div>
      </div>

      {isSkipping ? (
        <div className="mt-3 border-t border-gray-700 pt-3">
          <textarea
            value={skipText}
            onChange={e => onSkipTextChange(e.target.value)}
            placeholder="건너뛰는 이유를 적어주세요 (필수) — 예: 계좌 현금 부족, 이미 수동 처리함"
            rows={2}
            autoFocus
            className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-primary resize-none"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onCancelSkip} className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-md transition-colors">취소</button>
            <button
              onClick={onConfirmSkip}
              disabled={!skipText.trim()}
              className="text-xs font-medium text-white bg-gray-600 hover:bg-gray-500 px-3 py-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >건너뜀 저장</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2 mt-3 border-t border-gray-700 pt-3">
          <button onClick={onSnooze} className="text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-md transition-colors" title="내일 다시 알림">내일</button>
          <button onClick={onStartSkip} className="text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-md transition-colors">건너뜀</button>
          <button
            onClick={onDone}
            className="text-xs font-medium text-white bg-primary hover:bg-primary-dark px-3 py-1.5 rounded-md transition-colors"
            title={isTurtle
              ? '실제 체결일·체결가·수량을 입력해 매수/매도를 기록합니다'
              : '증권사에서 실행한 뒤 완료로 표시합니다'}
          >{isTurtle ? '실행하기' : '실행 완료'}</button>
        </div>
      )}
    </li>
  );
};

export default ExecutionView;
