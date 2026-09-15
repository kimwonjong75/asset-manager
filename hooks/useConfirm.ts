// hooks/useConfirm.ts
// 브라우저 기본 alert/confirm 대체용 Promise 기반 대화상자 상태 관리.
// 렌더는 components/common/ConfirmDialog가 담당(hooks/는 JSX를 만들지 않는다 — RULES.md §2).
// 사용:
//   const { confirm, notify, confirmRequest } = useConfirm();
//   if (await confirm('정말 삭제할까요?', { tone: 'danger', confirmLabel: '삭제' })) { ... }
//   await notify('선택한 자산이 이미 모두 해당 값입니다.');
//   return <>{...}{confirmRequest && <ConfirmDialog {...confirmRequest} />}</>;
//
// 알림 정책 (Stage C, 2026-09-15 사용자 승인 — RULES.md §7 사용자 알림)
//   · window.alert / window.confirm 을 쓰지 않는다.
//   · 파괴적 동작(삭제·복원·초기화·로그아웃) 확인 → confirm(..., { tone: 'danger' }).
//   · 폼 검증 오류 → 대화상자가 아니라 입력칸 근처 인라인 오류 문구.
//   · 정보 안내 → notify(), 작업 완료 → UpdateStatusIndicator 성공 메시지 경로.
//   · 플로팅 토스트는 만들지 않는다.

import { useCallback, useRef, useState } from 'react';

export type ConfirmTone = 'default' | 'danger';
export type ConfirmMode = 'confirm' | 'notify';

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

export interface NotifyOptions {
  title?: string;
  okLabel?: string;
}

/** ConfirmDialog 에 그대로 스프레드되는 요청 상태 */
export interface ConfirmRequest {
  mode: ConfirmMode;
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** notify 모드의 단일 버튼 라벨 */
  okLabel?: string;
  tone?: ConfirmTone;
  onConfirm: () => void;
  onCancel: () => void;
}

export function useConfirm() {
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  // 새 요청이 이전 요청을 덮으면 이전 Promise 를 '취소'로 정리한다(영원히 대기 방지)
  const cancelPendingRef = useRef<(() => void) | null>(null);

  const confirm = useCallback((message: string, opts: ConfirmOptions = {}): Promise<boolean> => {
    cancelPendingRef.current?.();
    return new Promise<boolean>((resolve) => {
      const settle = (value: boolean) => {
        cancelPendingRef.current = null;
        setConfirmRequest(null);
        resolve(value);
      };
      cancelPendingRef.current = () => resolve(false);
      setConfirmRequest({
        mode: 'confirm',
        message,
        title: opts.title,
        confirmLabel: opts.confirmLabel,
        cancelLabel: opts.cancelLabel,
        tone: opts.tone,
        onConfirm: () => settle(true),
        onCancel: () => settle(false),
      });
    });
  }, []);

  const notify = useCallback((message: string, opts: NotifyOptions = {}): Promise<void> => {
    cancelPendingRef.current?.();
    return new Promise<void>((resolve) => {
      const settle = () => {
        cancelPendingRef.current = null;
        setConfirmRequest(null);
        resolve();
      };
      cancelPendingRef.current = () => resolve();
      setConfirmRequest({
        mode: 'notify',
        message,
        title: opts.title,
        okLabel: opts.okLabel,
        onConfirm: settle,
        onCancel: settle,
      });
    });
  }, []);

  return { confirm, notify, confirmRequest };
}
