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
//
// P3(오늘 화면): **`embedded` prop** — `'execution'` 탭 자체가 UI에서 더는 도달 불가라 이 컴포넌트는
// 이제 사실상 `components/today/PendingOrdersSection.tsx`를 통해서만 마운트된다. embedded=true면
// 페이지 타이틀/설명·`TurtleSettingsPanel`(→ 설정의 `TurtleSettingsSection`으로 이전)·터틀 잠금 장문
// 안내를 숨긴다. **"오늘 주문 생성" 버튼과 `WhyNoOrderPanel`은 의도적으로 유지한다**(계획서 문면은
// 헤더 전체를 숨기라 했지만 기능 보존을 우선한 의도적 이탈 — RULES.md §3 참고):
//   · 리밸런싱 주문은 이 버튼이 유일한 생성 경로다(대청소는 CleanupView가 별도 생성) — 완전히
//     숨기면 오늘 화면에서 리밸런싱 주문을 만들 방법이 없어진다.
//   · WhyNoOrderPanel은 그 생성 버튼과 짝인 진단(0건일 때만 노출)이라, 버튼을 살려두면서 진단만
//     없애면 "왜 안 만들어지는지" 확인할 곳이 없어진다 — 옮겨 갈 다른 화면도 없다(설정은 상시
//     노출이라 부적합).

import React, { useMemo, useState } from 'react';
import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useActionQueue } from '../../hooks/useActionQueue';
import { ActionItem, ActionKind, isActiveAction } from '../../types/actionQueue';
import { isTurtleOrderLocked, isActionExecutionLocked, TURTLE_LOCK_MESSAGE } from '../../types/turtleLock';
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
  TURTLE_ENTRY:   { label: '신규 매수', dot: 'bg-up', badge: 'text-up border-up/40 bg-up-soft' },
  TURTLE_PYRAMID: { label: '불타기 추가', dot: 'bg-up', badge: 'text-up border-up/40 bg-up-soft' },
  TURTLE_STOP:    { label: '손절 매도', dot: 'bg-down', badge: 'text-down border-down/40 bg-down-soft' },
  TURTLE_EXIT:    { label: '청산 매도', dot: 'bg-down', badge: 'text-down border-down/40 bg-down-soft' },
  REBALANCE_SELL: { label: '리밸런싱 매도', dot: 'bg-down', badge: 'text-down border-down/40 bg-down-soft' },
  REBALANCE_BUY:  { label: '리밸런싱 매수', dot: 'bg-up', badge: 'text-up border-up/40 bg-up-soft' },
  CLEANUP_SELL:   { label: '대청소 정리', dot: 'bg-down', badge: 'text-down border-down/40 bg-down-soft' },
};

const fmt = (n: number): string =>
  Number.isFinite(n) ? n.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) : '—';

const todayISO = (): string => new Date().toISOString().slice(0, 10);

export interface ExecutionViewProps {
  /** true면 오늘 화면(PendingOrdersSection) 내장 모드 — 헤더/TurtleSettingsPanel/WhyNoOrderPanel 숨김 */
  embedded?: boolean;
}

const ExecutionView: React.FC<ExecutionViewProps> = ({ embedded = false }) => {
  const { actions } = usePortfolio();
  const { actionQueue, refreshActionQueue, markDone, markSkipped, snoozeAction, executeTurtleAction, executeCleanupAction, executeRebalanceAction, isRefreshing, refreshError } = useActionQueue();
  const turtleLocked = isTurtleOrderLocked();
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

  // 카드 목록 — full/embedded 공용(중복 없이 아래 두 return이 공유).
  const cardList = active.length === 0 ? (
    <div className="text-center text-gray-500 bg-surface-muted border border-border-subtle rounded-lg py-8 px-4">
      <p className="text-sm">대기 중인 주문이 없습니다.</p>
      {!embedded && <p className="text-xs mt-1">「오늘 주문 생성」을 눌러 터틀 규칙을 평가하세요.</p>}
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
          onDone={() => {
            if (isActionExecutionLocked(item.kind)) return; // fail-closed — 화면에서도 실행 진입 차단
            if (isTurtleKind(item.kind)) actions.openTurtleExecution(item);
            else if (isCleanupKind(item.kind)) actions.openCleanupExecution(item);
            else if (isRebalanceKind(item.kind)) actions.openRebalanceExecution(item);
            else markDone(item.id);
          }}
          isTurtle={needsExecuteModal(item.kind)}
          executionLocked={isActionExecutionLocked(item.kind)}
          onSnooze={() => snoozeAction(item.id, 1)}
        />
      ))}
    </ul>
  );

  const executeModals = (
    <>
      <TurtleExecuteModal executeTurtleAction={executeTurtleAction} />
      <CleanupExecuteModal executeCleanupAction={executeCleanupAction} />
      <RebalanceExecuteModal executeRebalanceAction={executeRebalanceAction} />
    </>
  );

  if (embedded) {
    return (
      <div>
        {/* 헤더/설명/TurtleSettingsPanel/WhyNoOrderPanel 생략(설정의 TurtleSettingsSection이 대체) —
            "오늘 주문 생성" 버튼만 상태 요약과 함께 유지(리밸런싱 생성의 유일한 경로, 위 주석 참고). */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>대기 <span className="text-gray-100 font-semibold">{active.length}</span>건</span>
            <span className="text-gray-500">·</span>
            <span>처리됨 {resolvedCount}건</span>
            {lastResult && <span className="text-gray-500">· {lastResult}</span>}
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || turtleLocked}
            className="flex-shrink-0 flex items-center gap-1.5 text-xs font-medium text-white bg-primary hover:bg-primary-dark px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={turtleLocked ? '터틀 주문 잠금 중 — 생성할 수 없습니다' : '지금 리밸런싱/터틀 규칙을 평가해 오늘 주문을 생성합니다'}
          >
            {isRefreshing && <Loader2 className="animate-spin h-3.5 w-3.5" aria-hidden="true" />}
            <span>{isRefreshing ? '생성 중...' : '오늘 주문 생성'}</span>
          </button>
        </div>
        {refreshError && (
          <div className="mb-3 text-sm text-danger bg-danger-soft border border-danger/30 rounded-md px-3 py-2">{refreshError}</div>
        )}
        {/* "오늘 주문 생성"을 눌러도 결과가 0건이면 이유를 알아야 하므로(생성 버튼과 짝인 진단),
            WhyNoOrderPanel만은 embedded에서도 유지한다 — TurtleSettingsPanel과 달리 이전할 다른
            화면이 없다(설정 화면은 상시 노출이라 부적합). 노출은 여전히 noOrderDiag가 있을 때뿐. */}
        {noOrderDiag && <WhyNoOrderPanel diagnostics={noOrderDiag} />}
        {cardList}
        {executeModals}
      </div>
    );
  }

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
          disabled={isRefreshing || turtleLocked}
          className="flex-shrink-0 flex items-center gap-1.5 text-xs sm:text-sm font-medium text-white bg-primary hover:bg-primary-dark px-3 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={turtleLocked ? '터틀 주문 잠금 중 — 생성할 수 없습니다' : '지금 터틀 규칙을 평가해 오늘 주문을 생성합니다 (화면 진입만으로는 생성되지 않습니다)'}
        >
          {isRefreshing
            ? <Loader2 className="animate-spin h-4 w-4" aria-hidden="true" />
            : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          <span>{isRefreshing ? '생성 중...' : '오늘 주문 생성'}</span>
        </button>
      </div>

      {/* 터틀 안전잠금 안내 — 사유를 사용자에게 표시(조용한 무동작 금지). 플로팅 토스트 아님. */}
      {turtleLocked && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-xs font-semibold text-amber-300">터틀 주문 잠금 중</p>
          <p className="text-xs text-amber-200/80 mt-1 leading-relaxed">{TURTLE_LOCK_MESSAGE}</p>
          <p className="text-xs text-amber-200/60 mt-1">
            기존 터틀 주문 기록은 그대로 보존됩니다. 손절·청산 확인은 홈의 «오늘의 터틀 확인» 카드에서 계속 볼 수 있습니다.
            리밸런싱·대청소 주문은 영향받지 않습니다.
          </p>
        </div>
      )}

      {/* 터틀(위성) 예산 설정 — 예산 0이면 진입 주문이 생성되지 않으므로 상단 노출 */}
      <TurtleSettingsPanel />

      {/* 상태 요약 */}
      <div className="flex items-center gap-3 text-xs text-gray-400 mb-3">
        <span>대기 <span className="text-gray-100 font-semibold">{active.length}</span>건</span>
        <span className="text-gray-500">·</span>
        <span>처리됨 {resolvedCount}건</span>
        {lastResult && <span className="text-gray-500">· {lastResult}</span>}
      </div>

      {refreshError && (
        <div className="mb-3 text-sm text-danger bg-danger-soft border border-danger/30 rounded-md px-3 py-2">{refreshError}</div>
      )}

      {/* 0건일 때 "왜 주문이 없나요?" 진단 */}
      {noOrderDiag && <WhyNoOrderPanel diagnostics={noOrderDiag} />}

      {/* 주문 카드 목록 (embedded 분기와 공유 — 위 cardList) */}
      {cardList}

      {/* 실행 모달 — 각 executeXxxAction을 prop으로 전달(훅 인스턴스 중복 방지) */}
      {executeModals}
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
  /** 터틀 안전잠금 중 — 기록은 보존하고 실행만 막는다 */
  executionLocked: boolean;
  onSnooze: () => void;
}

const ActionCard: React.FC<ActionCardProps> = ({
  item, today, isSkipping, skipText, onSkipTextChange, onStartSkip, onConfirmSkip, onCancelSkip, onDone, isTurtle, executionLocked, onSnooze,
}) => {
  const meta = KIND_META[item.kind];
  const level = actionEscalationLevel(item, today);
  const days = actionDaysIgnored(item, today);
  const ring = level === 2 ? 'border-orange-500/70 ring-1 ring-orange-500/40' : level === 1 ? 'border-amber-500/50' : 'border-border-subtle';

  return (
    <li className={`bg-surface-elevated border ${ring} rounded-lg p-3.5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${meta.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />{meta.label}
            </span>
            <span className="text-white font-semibold truncate">{item.name}</span>
            <span className="text-xs text-gray-500">{item.ticker}</span>
            {item.status === 'snoozed' && (
              <span className="text-xs text-gray-400 bg-gray-700/60 px-1.5 py-0.5 rounded">내일 다시</span>
            )}
            {executionLocked && (
              <span className="text-xs text-amber-300 border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 rounded">현재 실행 잠금</span>
            )}
          </div>
          <p className="text-sm text-gray-300 mt-1.5">{item.reasonText}</p>
          <div className="flex items-center gap-3 text-xs text-gray-400 mt-1.5">
            <span>수량 <span className="text-gray-200 font-medium">{fmt(item.quantity)}</span></span>
            <span>기준가 <span className="text-gray-200 font-medium">{fmt(item.refPrice)}</span></span>
            {days > 0 && (
              <span className={`inline-flex items-center gap-1 ${level >= 1 ? 'text-amber-300 font-medium' : ''}`}>
                {level === 2 && <TriangleAlert className="h-3.5 w-3.5" aria-label="경고" />}
                {days}일째 미실행
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
              className="text-xs font-medium text-white bg-gray-600 hover:bg-zinc-500 px-3 py-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >건너뜀 저장</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2 mt-3 border-t border-gray-700 pt-3">
          <button onClick={onSnooze} className="text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-md transition-colors" title="내일 다시 알림">내일</button>
          <button onClick={onStartSkip} className="text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-md transition-colors">건너뜀</button>
          <button
            onClick={onDone}
            disabled={executionLocked}
            className="text-xs font-medium text-white bg-primary hover:bg-primary-dark px-3 py-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={executionLocked
              ? TURTLE_LOCK_MESSAGE
              : isTurtle
                ? '실제 체결일·체결가·수량을 입력해 매수/매도를 기록합니다'
                : '증권사에서 실행한 뒤 완료로 표시합니다'}
          >{executionLocked ? '실행 잠금' : isTurtle ? '실행하기' : '실행 완료'}</button>
        </div>
      )}
    </li>
  );
};

export default ExecutionView;
