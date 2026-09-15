import React, { useState, useRef, useCallback } from 'react';
import { useConfirm } from '../../hooks/useConfirm';
import ConfirmDialog from './ConfirmDialog';
import Modal from './Modal';
import Button from './Button';

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

  // Esc 는 Modal 이 onClose(=handleClose, dirty 확인)로 처리한다 — 여기서는 Ctrl/Cmd+Enter 저장만.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  }, [handleSave]);

  return (
    <>
    {/* 모달 닫기 보호(RULES.md §8): Esc·백드롭·X 모두 dirty 확인 래퍼 handleClose */}
    <Modal
      open
      onClose={handleClose}
      title={<span className="block truncate">{title} 메모</span>}
      size="sm"
      initialFocusRef={textareaRef}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>취소</Button>
          <Button variant="primary" onClick={handleSave}>저장</Button>
        </>
      }
    >
      <textarea
        ref={textareaRef}
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        aria-label="메모"
        className="w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition resize-none"
        rows={5}
        placeholder="종목에 대한 메모를 입력하세요..."
        onKeyDown={handleKeyDown}
      />
      <p className="text-xs text-gray-500 mt-1">Ctrl+Enter로 저장, Esc로 닫기</p>
    </Modal>
    {confirmRequest && <ConfirmDialog {...confirmRequest} />}
    </>
  );
};

export default MemoEditPopup;
