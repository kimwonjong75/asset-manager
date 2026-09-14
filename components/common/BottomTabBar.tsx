// components/common/BottomTabBar.tsx
// P6 모바일 하단 탭바 — md 미만에서만 표시(App.tsx가 상단 탭 nav를 같은 breakpoint로 숨김).
// 홈/보유자산/관심종목 3개 + 더보기(데스크탑 더보기 드롭다운과 **같은 items 배열**을 공유 —
// App.tsx가 하나의 moreMenuItems를 만들어 데스크탑 ActionMenu와 여기 양쪽에 넘긴다).
// 2026-09-14: '오늘' 탭 폐지 → 첫 탭은 홈(dashboard). 대시보드는 더보기 메뉴에서 빠졌다.
// ActionMenu는 <768px에서 자동으로 바텀시트로 렌더되므로 이 컴포넌트는 anchorRef+상태만 관리.
// 렌더 전용 — 탭 이동/메뉴 동작은 전부 props로 받은 콜백에 위임.

import React, { useRef, useState } from 'react';
import { House, Briefcase, Star, MoreHorizontal, type LucideIcon } from 'lucide-react';
import ActionMenu, { type ActionMenuItem } from './ActionMenu';

export type BottomTabId = 'dashboard' | 'portfolio' | 'watchlist';

interface TabDef {
  id: BottomTabId;
  label: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { id: 'dashboard', label: '홈', icon: House },
  { id: 'portfolio', label: '보유자산', icon: Briefcase },
  { id: 'watchlist', label: '관심종목', icon: Star },
];

export interface BottomTabBarProps {
  activeTab: string;
  onTabChange: (tab: BottomTabId) => void;
  /** 현재 탭이 더보기 진입 화면(수익통계/설정/연구실 등) 중 하나라 '더보기' 버튼을 강조할지 */
  moreActive: boolean;
  /** 더보기 메뉴 항목 — 데스크탑 더보기 드롭다운과 동일 배열(App.tsx에서 공유) */
  moreMenuItems: ActionMenuItem[];
}

const BottomTabBar: React.FC<BottomTabBarProps> = ({ activeTab, onTabChange, moreActive, moreMenuItems }) => {
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);

  // 터치 타깃 44px 이상(계획서 §4.4) — min-h-11(44px) + 세로 패딩으로 여유 확보.
  const itemBase =
    'flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 min-h-11 py-1.5 text-xs font-medium transition-colors';

  return (
    <nav
      className="hide-when-modal fixed bottom-0 left-0 right-0 z-nav bg-surface-elevated border-t border-border-subtle flex md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="주요 화면 이동"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            className={`${itemBase} ${active ? 'text-primary' : 'text-gray-400'}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 2} />
            <span>{label}</span>
          </button>
        );
      })}
      <button
        ref={moreRef}
        type="button"
        onClick={() => setShowMore(v => !v)}
        aria-haspopup="menu"
        aria-expanded={showMore}
        className={`${itemBase} ${moreActive ? 'text-primary' : 'text-gray-400'}`}
      >
        <MoreHorizontal className="h-5 w-5" strokeWidth={moreActive ? 2.25 : 2} />
        <span>더보기</span>
      </button>
      {showMore && <ActionMenu anchorRef={moreRef} items={moreMenuItems} onClose={() => setShowMore(false)} />}
    </nav>
  );
};

export default BottomTabBar;
