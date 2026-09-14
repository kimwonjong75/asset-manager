// components/common/ConfirmDialog.tsx
// P6 정보 다이어트 — 비파괴 확인창을 window.confirm 대신 앱 룩에 맞는 모달로 대체한다
// (삭제/로그아웃 등 실제 파괴적 동작의 window.confirm은 그대로 둔다 — 브라우저 기본 확인이
// "정말 삭제" 같은 최종 관문으로는 더 무겁게 느껴지는 편이 안전하다는 판단, 계획서 §4.5).
// hooks/useConfirm이 상태(message/onConfirm/onCancel)를 만들어 넘기고, 이 컴포넌트는 렌더만 한다.

import React from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert } from 'lucide-react';
import Button from './Button';

export interface ConfirmDialogProps {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Stage B: 'danger'면 확인 버튼을 파괴적 동작 스타일(핑크 채움 + 아이콘)로. 기본 'default'(primary) */
  tone?: 'default' | 'danger';
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  onConfirm,
  onCancel,
  tone = 'default',
}) => {
  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 flex justify-center items-center z-dialog p-4"
      onClick={onCancel}
      role="alertdialog"
      aria-modal="true"
    >
      <div
        className="bg-surface-elevated border border-border-subtle rounded-card shadow-xl w-full max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-gray-100 whitespace-pre-wrap leading-relaxed">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          {tone === 'danger' ? (
            <Button variant="danger" icon={<CircleAlert />} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          ) : (
            <Button variant="primary" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ConfirmDialog;
