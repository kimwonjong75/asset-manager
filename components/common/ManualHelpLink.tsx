// components/common/ManualHelpLink.tsx
// ---------------------------------------------------------------------------
// "? 설명" 작은 링크 — 6곳(TurtleHoldingsTodayCard/TurtleHoldingsBuyModal/TurtleCleanupView/
// TurtleHoldingsSettingsSection/KakaoNotifySection/SellAssetModal)이 공유하는 단일 컴포넌트.
// 누르면 '사용설명서' 탭으로 이동 + 해당 앵커로 스크롤(components/layouts/ManualView.tsx가
// mount 시 location.hash를 읽어 처리). 모달 안에서 쓸 때는 onBeforeNavigate로 모달을 먼저 닫는다
// (탭이 바뀌어도 열린 모달이 화면 위에 남아있는 것을 막는다 — RULES.md §8 모달 관례).
//
// anchor 값은 반드시 docs/터틀_사용설명서.md의 실제 <a id="..."> 12개 중 하나여야 한다 —
// tests/manualIntegrity.ts가 이 컴포넌트를 쓰는 모든 anchor 문자열을 정적 스캔해 문서에 존재하는지
// 고정 검증한다(② 항목). 렌더 전용 — 업무 로직 없음.

import React from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';

export interface ManualHelpLinkProps {
  /** docs/터틀_사용설명서.md 앵커 id (예: 'today', 'rebuy'). 리터럴 문자열로만 넘길 것(정적 스캔 대상). */
  anchor: string;
  /** 모달 안에서 쓸 때 — 이동 직전 모달을 닫는다(예: onClose). */
  onBeforeNavigate?: () => void;
  className?: string;
}

const DEFAULT_CLASS = 'inline-flex items-center gap-0.5 text-xs text-primary-light hover:text-primary hover:underline focus-ring rounded';

const ManualHelpLink: React.FC<ManualHelpLinkProps> = ({ anchor, onBeforeNavigate, className }) => {
  const { actions } = usePortfolio();

  const handleClick = () => {
    onBeforeNavigate?.();
    // 해시를 먼저 정해 둬야 ManualView가 mount 되는 순간 바로 그 앵커로 스크롤한다.
    window.location.hash = anchor;
    actions.setActiveTab('manual');
  };

  return (
    <button type="button" onClick={handleClick} className={className ?? DEFAULT_CLASS}>
      <span aria-hidden="true">?</span> 설명
    </button>
  );
};

export default ManualHelpLink;
