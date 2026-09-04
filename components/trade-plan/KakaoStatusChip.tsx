// components/trade-plan/KakaoStatusChip.tsx
// 카카오톡 알림 상태 칩 — "마지막 동기화 HH:MM · 동기화 필요 N건". 렌더 전용, 계산은 hooks/useKakaoNotify.
// "오늘" 화면(TodayView) 헤더에 마운트되는 카톡 알림 상태칩 — 계획서 §6.1 "오늘 화면 상태칩"(P5 작성, P3에서 마운트).
// self-contained(usePortfolio를 내부 훅이 대신 읽음)라
// import해서 <KakaoStatusChip /> 한 줄만 놓으면 된다.

import React from 'react';
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
  const { settings, manifest, needsSync } = useKakaoNotify();

  // 설정 전(웹앱 URL/시크릿 미입력)이면 표시하지 않음 — 아직 쓰지 않는 기능을 오늘 화면에 노출하지 않는다.
  if (!settings.gasUrl || !settings.secret) return null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full bg-gray-800/70 border border-gray-700 ${className}`}
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
