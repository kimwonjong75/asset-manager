// components/trade-plan/KakaoStatusChip.tsx
// 카카오톡 알림 상태 칩 — "마지막 동기화 HH:MM · 동기화 필요 N건". 렌더 전용, 계산은 hooks/useKakaoNotify.
// 홈 '오늘의 브리핑'(components/today/TodayActionCenter) 헤더에 마운트되는 카톡 알림 상태칩 — 계획서 §6.1
// "오늘 화면 상태칩"(P5 작성, P3에서 TodayView에 마운트 → 2026-09-14 홈 통합으로 이동).
// import해서 <KakaoStatusChip /> 한 줄만 놓으면 된다.
//
// 미설정 상태에서도 표시한다(과거에는 null 반환 — 설정 화면까지 안내가 전혀 없어 카톡을 어떻게 받는지
// 알 방법이 없었다). 클릭하면 설정 탭으로 이동 — usePortfolio.actions.setActiveTab, 쓰기 없는 탐색뿐이라
// "보이지 않는 쓰기 금지" 규칙과 무관.

import React from 'react';
import { Bell } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useKakaoNotify } from '../../hooks/useKakaoNotify';

function formatTime(iso: string | null): string {
  if (!iso) return '없음';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '없음';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface KakaoStatusChipProps {
  className?: string;
}

const KakaoStatusChip: React.FC<KakaoStatusChipProps> = ({ className = '' }) => {
  const { actions } = usePortfolio();
  const { settings, manifest, needsSync } = useKakaoNotify();

  if (!settings.gasUrl || !settings.secret) {
    return (
      <button
        type="button"
        onClick={() => actions.setActiveTab('settings')}
        className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-amber-500/10 border border-amber-700/40 text-amber-300 hover:bg-amber-500/20 transition-colors ${className}`}
        title="설정 탭에서 카카오톡 알림을 켤 수 있습니다"
      >
        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
        카톡 알림 미설정 · 설정에서 켜기
      </button>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-surface-muted border border-border-subtle ${className}`}
      title="카카오톡 알림 동기화 상태"
    >
      <span className="text-gray-400">카톡 알림</span>
      <span className="text-gray-300">마지막 동기화 {formatTime(settings.lastSyncAt)}</span>
      {needsSync && (
        <span className="text-amber-400">· 동기화 필요 {manifest.items.length}건</span>
      )}
    </span>
  );
};

export default KakaoStatusChip;
