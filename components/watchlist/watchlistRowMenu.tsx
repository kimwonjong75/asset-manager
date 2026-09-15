// components/watchlist/watchlistRowMenu.tsx
// 관심종목 행 관리 메뉴 항목 — 데스크탑 표(WatchlistPage)와 모바일 카드(WatchlistMobileCard)가 **같은 함수**로
// 항목을 만들어 순서·라벨·아이콘이 절대 어긋나지 않게 한다(ui-constraints: 표 기능은 모바일에도).
// 순서: 매매 계획 · 종목 검토 · ─ · 수정 · 터틀 · 차트 보기 · 차트 확대 · ─ · 삭제
// 동작(삭제 확인 대화상자 포함)은 호출부 핸들러가 담당 — 여기는 메뉴 모양만.

import React from 'react';
import { ChartColumn, ClipboardList, Maximize2, Pencil, SearchCheck, Trash2 } from 'lucide-react';
import type { ActionMenuEntry } from '../common/ActionMenu';

export interface WatchlistRowMenuHandlers {
  isTurtleCandidate: boolean;
  onTradePlan: () => void;
  onReview: () => void;
  onEdit: () => void;
  /** 없으면 터틀 항목을 넣지 않는다 */
  onToggleTurtle?: () => void;
  onChartView: () => void;
  onChartExpand: () => void;
  onDelete: () => void;
}

export function buildWatchlistRowMenuItems(h: WatchlistRowMenuHandlers): ActionMenuEntry[] {
  const items: ActionMenuEntry[] = [
    { label: '매매 계획', icon: <ClipboardList />, onClick: h.onTradePlan },
    { label: '종목 검토', icon: <SearchCheck />, onClick: h.onReview },
    { type: 'separator' },
    { label: '수정', icon: <Pencil />, onClick: h.onEdit },
  ];
  if (h.onToggleTurtle) {
    items.push({
      label: h.isTurtleCandidate ? '터틀 후보 해제' : '터틀 후보 지정',
      icon: <span>🐢</span>,
      onClick: h.onToggleTurtle,
    });
  }
  items.push(
    { label: '차트 보기', icon: <ChartColumn />, onClick: h.onChartView },
    { label: '차트 확대', icon: <Maximize2 />, onClick: h.onChartExpand },
    { type: 'separator' },
    { label: '삭제', icon: <Trash2 />, onClick: h.onDelete, colorClass: 'text-danger' },
  );
  return items;
}
