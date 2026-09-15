// components/portfolio-table/rowMenuItems.tsx
// 포트폴리오 행(데스크탑 PortfolioTableRow)·카드(모바일 PortfolioMobileCard) 관리 메뉴 항목 — 두 곳이 **같은 순서**를
// 쓰도록 한 군데에서 만든다(Stage D1). 렌더 보조 전용, 상태·로직 없음.
//   매매 계획 · 종목 검토 | 매수 · 매도 | 가격 업데이트 · 수정 · 차트 보기 · 차트 확대
//   색 규약: 매수 text-up(빨강) / 매도 text-down(파랑). 나머지는 기본색.

import React from 'react';
import { ClipboardList, LineChart, Maximize2, Minus, Pencil, Plus, RefreshCw, SearchCheck } from 'lucide-react';
import type { ActionMenuEntry, ActionMenuItem } from '../common/ActionMenu';

export interface AssetRowMenuHandlers {
  onTradePlan: () => void;
  onStockReview: () => void;
  onBuy?: () => void;
  onSell?: () => void;
  onRefresh?: () => void;
  onEdit: () => void;
  onToggleChart: () => void;
  chartExpanded: boolean;
  onFullscreen: () => void;
}

export function buildAssetRowMenuItems(h: AssetRowMenuHandlers): ActionMenuEntry[] {
  const trade: ActionMenuItem[] = [
    ...(h.onBuy ? [{ label: '매수', icon: <Plus />, colorClass: 'text-up', onClick: h.onBuy }] : []),
    ...(h.onSell ? [{ label: '매도', icon: <Minus />, colorClass: 'text-down', onClick: h.onSell }] : []),
  ];
  const manage: ActionMenuItem[] = [
    ...(h.onRefresh ? [{ label: '가격 업데이트', icon: <RefreshCw />, onClick: h.onRefresh }] : []),
    { label: '수정', icon: <Pencil />, onClick: h.onEdit },
    { label: h.chartExpanded ? '차트 접기' : '차트 보기', icon: <LineChart />, onClick: h.onToggleChart },
    { label: '차트 확대', icon: <Maximize2 />, onClick: h.onFullscreen },
  ];
  return [
    { label: '매매 계획', icon: <ClipboardList />, onClick: h.onTradePlan },
    { label: '종목 검토', icon: <SearchCheck />, onClick: h.onStockReview },
    ...(trade.length > 0 ? [{ type: 'separator' } as const, ...trade] : []),
    { type: 'separator' },
    ...manage,
  ];
}
