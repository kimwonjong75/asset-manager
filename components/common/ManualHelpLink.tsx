// components/common/ManualHelpLink.tsx
// ---------------------------------------------------------------------------
// "? 설명" 작은 링크 — 6곳(TurtleHoldingsTodayCard/TurtleHoldingsBuyModal/TurtleCleanupView/
// TurtleHoldingsSettingsSection/KakaoNotifySection/SellAssetModal)이 공유하는 단일 컴포넌트.
//
// 2026-09-27부터: 클릭하면 탭을 바꾸지 않고 화면(또는 열려 있는 모달) 옆에 사이드 패널
// (`ManualDrawer`)을 열어 해당 앵커 구간만 보여준다 — 예전처럼 '사용설명서' 탭 전체로 이동하거나
// (모달 안에서는) 모달을 먼저 닫는 동작은 하지 않는다(`onBeforeNavigate`는 더 이상 이 클릭 경로에서
// 호출되지 않는다 — 아래 "전체 보기" 경로 전용으로 남긴다). 드로어 footer의 "설명서 전체 보기"를
// 누르면 그때 `onBeforeNavigate?.()`(모달을 닫아야 하면) → 예전 방식대로 hash + 탭 전환.
//
// 링크를 다시 누르면(이미 열려 있을 때) 그 앵커로 갱신만 하고 드로어는 열린 채 유지한다(토글 아님).
//
// anchor 값은 반드시 docs/터틀_사용설명서.md의 실제 <a id="..."> 12개 중 하나여야 한다 —
// tests/manualIntegrity.ts가 이 컴포넌트를 쓰는 모든 anchor 문자열을 정적 스캔해 문서에 존재하는지
// 고정 검증한다(② 항목). 이 컴포넌트는 상태(열림 여부·현재 앵커)만 갖고, 렌더는 ManualDrawer에 위임.

import React, { useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import ManualDrawer from './ManualDrawer';

export interface ManualHelpLinkProps {
  /** docs/터틀_사용설명서.md 앵커 id (예: 'today', 'rebuy'). 리터럴 문자열로만 넘길 것(정적 스캔 대상). */
  anchor: string;
  /** "설명서 전체 보기"로 이동하기 직전 — 모달 안에서 쓸 때 모달을 먼저 닫는다(예: onClose). */
  onBeforeNavigate?: () => void;
  className?: string;
}

const DEFAULT_CLASS = 'inline-flex items-center gap-0.5 text-xs text-primary-light hover:text-primary hover:underline focus-ring rounded';

const ManualHelpLink: React.FC<ManualHelpLinkProps> = ({ anchor, onBeforeNavigate, className }) => {
  const { actions } = usePortfolio();
  const [open, setOpen] = useState(false);
  const [activeAnchor, setActiveAnchor] = useState(anchor);

  const handleClick = () => {
    setActiveAnchor(anchor);
    setOpen(true);
  };

  const handleOpenFullManual = () => {
    onBeforeNavigate?.();
    setOpen(false);
    // 해시를 먼저 정해 둬야 ManualView가 mount 되는 순간 바로 그 앵커로 스크롤한다.
    window.location.hash = activeAnchor;
    actions.setActiveTab('manual');
  };

  return (
    <>
      <button type="button" onClick={handleClick} className={className ?? DEFAULT_CLASS}>
        <span aria-hidden="true">?</span> 설명
      </button>
      <ManualDrawer
        open={open}
        anchor={activeAnchor}
        onAnchorChange={setActiveAnchor}
        onClose={() => setOpen(false)}
        onOpenFullManual={handleOpenFullManual}
      />
    </>
  );
};

export default ManualHelpLink;
