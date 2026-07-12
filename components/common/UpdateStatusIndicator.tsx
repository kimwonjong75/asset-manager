import React, { useEffect, useState } from 'react';
import { STORAGE_WARNING_EVENT } from '../../utils/safeStorage';

interface UpdateStatusIndicatorProps {
  isLoading: boolean;
  successMessage: string | null;
}

const STORAGE_WARNING_MESSAGE =
  '저장 공간이 가득 찼습니다. 일부 데이터가 저장되지 않았습니다. (브라우저 localStorage 용량 초과)';
// 경보 자동 소거 시간(ms) — 사용자가 인지할 만큼 표시 후 사라진다(플로팅 토스트 아님, 상태줄 재사용).
const STORAGE_WARNING_TTL = 8000;

const UpdateStatusIndicator: React.FC<UpdateStatusIndicatorProps> = ({ isLoading, successMessage }) => {
  // 저장 용량 초과 경보(setItemSafe 발화 CustomEvent) — 자기완결 로컬 상태로 상태줄에 에러 스타일 표시.
  const [storageWarning, setStorageWarning] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWarn = () => {
      setStorageWarning(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setStorageWarning(false), STORAGE_WARNING_TTL);
    };
    window.addEventListener(STORAGE_WARNING_EVENT, onWarn);
    return () => {
      window.removeEventListener(STORAGE_WARNING_EVENT, onWarn);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 용량 초과 경보 우선 표시(에러 스타일) — 진행/성공 표시보다 사용자 조치가 필요.
  if (storageWarning) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-red-400" role="alert">
        <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <span>{STORAGE_WARNING_MESSAGE}</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-blue-400">
        <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span>{successMessage || '업데이트 중...'}</span>
      </div>
    );
  }

  if (successMessage && !successMessage.includes('중...')) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-400">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <span>{successMessage}</span>
      </div>
    );
  }

  return null;
};

export default UpdateStatusIndicator;
