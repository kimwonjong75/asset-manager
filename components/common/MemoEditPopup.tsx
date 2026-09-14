import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useConfirm } from '../../hooks/useConfirm';
import ConfirmDialog from './ConfirmDialog';

interface MemoEditPopupProps {
  title: string;
  memo: string;
  onSave: (memo: string) => void;
  onClose: () => void;
}

const MemoEditPopup: React.FC<MemoEditPopupProps> = ({ title, memo: initialMemoValue, onSave, onClose }) => {
  const [memo, setMemo] = useState(initialMemoValue);
  const initialMemo = useRef(initialMemoValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { confirm, confirmRequest } = useConfirm();

  const isDirty = memo !== initialMemo.current;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleClose = useCallback(() => {
    if (isDirty) {
      void confirm('수정 중인 내용이 있습니다. 저장하지 않고 닫으시겠습니까?').then(ok => {
        if (ok) onClose();
      });
    } else {
      onClose();
    }
  }, [isDirty, onClose, confirm]);

  const handleSave = useCallback(() => {
    onSave(memo.trim());
    onClose();
  }, [onSave, memo, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  }, [handleClose, handleSave]);

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex justify-center items-center z-modal"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="메모 편집"
      onKeyDown={handleKeyDown}
    >
      {confirmRequest && <ConfirmDialog {...confirmRequest} />}
      <div
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 border border-gray-600"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white truncate">
            {title} 메모
          </h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white p-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4">
          <textarea
            ref={textareaRef}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition resize-none"
            rows={5}
            placeholder="종목에 대한 메모를 입력하세요..."
            onKeyDown={handleKeyDown}
          />
          <p className="text-xs text-gray-500 mt-1">Ctrl+Enter로 저장, Esc로 닫기</p>
        </div>
        <div className="px-4 pb-4 flex justify-end gap-2">
          <button
            onClick={handleClose}
            className="bg-gray-600 hover:bg-zinc-500 text-white text-sm font-medium py-1.5 px-3 rounded-md transition"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            className="bg-primary hover:bg-primary-dark text-white text-sm font-bold py-1.5 px-3 rounded-md transition"
          >
            저장
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default MemoEditPopup;
