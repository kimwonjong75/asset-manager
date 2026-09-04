// hooks/useConfirm.ts
// P6 — window.confirm(동기·브라우저 기본 UI) 대체용 Promise 기반 확인창 상태 관리.
// 렌더는 components/common/ConfirmDialog가 담당(hooks/는 JSX를 만들지 않는다 — RULES.md §2).
// 사용:
//   const { confirm, confirmRequest } = useConfirm();
//   const onClick = async () => { if (await confirm('정말 진행할까요?')) { ... } };
//   return <>{...}{confirmRequest && <ConfirmDialog {...confirmRequest} />}</>;
//
// 실제 데이터 삭제/로그아웃 등 파괴적 동작은 대상이 아니다(계획서 §4.5 — window.confirm 유지).

import { useCallback, useState } from 'react';

export interface ConfirmRequest {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function useConfirm() {
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setConfirmRequest({
        message,
        onConfirm: () => { setConfirmRequest(null); resolve(true); },
        onCancel: () => { setConfirmRequest(null); resolve(false); },
      });
    });
  }, []);

  return { confirm, confirmRequest };
}
