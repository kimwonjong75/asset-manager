// utils/actionQueueCompaction.ts
// ---------------------------------------------------------------------------
// 완료된 실행 큐(actionQueue) 항목의 보존기간 경과분 정리 (Phase 5, P5 — 순수).
//
// 목적: done/skipped로 해결된 지 오래된(기본 90일) 주문 항목만 메인 payload에서 걷어내
//   Drive 저장 페이로드의 무한 누적을 막는다. **자동 아님** — 설정 패널의 명시적 버튼이 트리거.
//   복구원은 자동 백업(portfolio_backup_*.json)이므로 메인에서의 제거는 손실이 아니다.
//
// 참조 무결성(Advisor 검증): ActionItem을 id로 참조하는 데이터는 없다.
//   sellHistory/turtlePositions는 독립적이며, ActionItem이 가리키는 쪽(linkedSellRecordId·
//   positionId)의 대상(SellRecord/TurtlePosition)은 그대로 유지된다. 따라서 resolved
//   (done/skipped) 항목 제거는 dangling 참조를 만들지 않아 안전하다.
//
// 안전 규칙:
//   · pending/snoozed는 **항상 유지** (아직 사용자 행동 대기 중).
//   · resolvedDate 없는 done/skipped(방어적)도 유지 — 경과일을 판정할 수 없다.
//   · 순서 보존.
//   · 날짜는 today 인자만 사용 — Date.now()/인자 없는 new Date() 금지(테스트 결정성).

import type { ActionItem } from '../types/actionQueue';

/** 완료 주문 보존기간(일). 이 일수를 초과해 해결된 done/skipped만 정리 대상. */
export const ACTION_QUEUE_RETENTION_DAYS = 90;

export interface ActionQueueCompactionResult {
  /** 유지되는 항목(정리 후 새 큐). */
  kept: ActionItem[];
  /** 제거되는 항목(백업으로만 복구 가능). */
  removed: ActionItem[];
}

/** today('YYYY-MM-DD')에서 days일 뺀 날짜 문자열('YYYY-MM-DD', UTC 기준 계산). */
function subtractDays(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * 보존기간을 초과해 해결된 done/skipped 주문을 걷어낸다.
 * 제거 조건: (status==='done' || status==='skipped') AND resolvedDate 존재 AND resolvedDate < cutoff.
 * cutoff = today - olderThanDays일. 문자열 사전순 비교('YYYY-MM-DD'는 사전순=시간순).
 */
export function compactResolvedActions(
  queue: ActionItem[],
  opts: { today: string; olderThanDays?: number }
): ActionQueueCompactionResult {
  const olderThanDays = opts.olderThanDays ?? ACTION_QUEUE_RETENTION_DAYS;
  const cutoff = subtractDays(opts.today, olderThanDays);

  const kept: ActionItem[] = [];
  const removed: ActionItem[] = [];

  for (const item of queue) {
    const isResolved = item.status === 'done' || item.status === 'skipped';
    const shouldRemove = isResolved && !!item.resolvedDate && item.resolvedDate < cutoff;
    if (shouldRemove) removed.push(item);
    else kept.push(item);
  }

  return { kept, removed };
}
