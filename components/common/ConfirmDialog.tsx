// components/common/ConfirmDialog.tsx
// 앱 룩 확인/안내 대화상자 — hooks/useConfirm 이 만든 요청 상태를 그대로 스프레드해 렌더만 한다.
//   mode 'confirm' = 취소 + 확인 두 버튼 → Promise<boolean>
//   mode 'notify'  = 확인 한 버튼(정보 안내) → Promise<void>
// 알림 정책(Stage C, RULES.md §7): 브라우저 alert/confirm 금지. 파괴적 동작은 tone='danger'
// (핑크 채움 + 아이콘 버튼, 초기 포커스는 '취소'), 폼 검증은 인라인 오류 문구, 완료 안내는
// UpdateStatusIndicator, 플로팅 토스트 금지.
//
// z-dialog(80) — Modal(z-modal 60) 위에 뜬다. Esc 는 window capture 단계에서 처리하고
// stopPropagation 하므로 아래 Modal 의 Esc(onClose)가 함께 발화하지 않는다.

import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert } from 'lucide-react';
import Button from './Button';
import type { ConfirmMode, ConfirmTone } from '../../hooks/useConfirm';

export interface ConfirmDialogProps {
  message: string;
  /** 기본 'confirm' */
  mode?: ConfirmMode;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** notify 모드 단일 버튼 라벨(기본 '확인') */
  okLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 'danger'면 확인 버튼을 파괴적 동작 스타일(핑크 채움 + 아이콘)로. 기본 'default'(primary) */
  tone?: ConfirmTone;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  message,
  mode = 'confirm',
  title,
  confirmLabel = '확인',
  cancelLabel = '취소',
  okLabel = '확인',
  onConfirm,
  onCancel,
  tone = 'default',
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  // Esc = 취소(notify 는 확인과 동일). 아래 모달까지 전파되지 않게 capture 단계에서 막는다.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancelRef.current();
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, []);

  // 초기 포커스(파괴적 확인은 '취소'에) + 닫힐 때 이전 포커스 복귀
  const isDanger = mode === 'confirm' && tone === 'danger';
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = isDanger ? cancelRef.current : confirmRef.current;
    target?.focus({ preventScroll: true });
    return () => {
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
    // 사실상 마운트 1회 — 요청마다 호출부가 조건부 마운트한다
  }, [isDanger]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const items = [cancelRef.current, confirmRef.current].filter((b): b is HTMLButtonElement => b !== null);
    if (items.length === 0) return;
    const idx = items.findIndex(b => b === document.activeElement);
    e.preventDefault();
    const next = e.shiftKey ? (idx <= 0 ? items.length - 1 : idx - 1) : (idx + 1) % items.length;
    items[next]?.focus();
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 flex justify-center items-center z-dialog p-4"
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={messageId}
        aria-label={title ? undefined : mode === 'notify' ? '안내' : '확인'}
        className="bg-surface-elevated border border-border-subtle rounded-card shadow-xl w-full max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {title && (
          <h2 id={titleId} className="text-base font-semibold text-white mb-1.5">
            {title}
          </h2>
        )}
        <p id={messageId} className="text-sm text-gray-100 whitespace-pre-wrap leading-relaxed">
          {message}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          {mode === 'notify' ? (
            <Button ref={confirmRef} variant="primary" onClick={onConfirm}>
              {okLabel}
            </Button>
          ) : (
            <>
              <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
                {cancelLabel}
              </Button>
              {isDanger ? (
                <Button ref={confirmRef} variant="danger" icon={<CircleAlert />} onClick={onConfirm}>
                  {confirmLabel}
                </Button>
              ) : (
                <Button ref={confirmRef} variant="primary" onClick={onConfirm}>
                  {confirmLabel}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ConfirmDialog;
