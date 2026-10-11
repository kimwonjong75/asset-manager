// components/layouts/ManualView.tsx
// ---------------------------------------------------------------------------
// '사용설명서' 탭 — docs/터틀_사용설명서.md를 그대로 렌더한다(RULES.md §2: 렌더 전용, 계산은
// utils/manualTemplate). 3가지로 "앱이 바뀌면 문서도 자동으로 맞는다":
//   ① 번들 포함 — Vite `?raw` import라 앱을 빌드할 때마다 최신 md가 그대로 딸려온다(복사본 없음).
//   ② 설정값 치환 — {{키}}를 지금 사용자의 실제 터틀 설정(resolveHoldingsSettings)으로 바꾼다.
//   ③ 검사 게이트 — tests/manualIntegrity.ts가 앵커·대괄호 문구·치환 결과를 고정 검증한다
//      (문서가 코드와 어긋나면 npm test가 실패 → 문서를 고치게 만드는 구조).
//
// 마크다운 렌더링(제목 커스텀 렌더러·칩·표 스타일 등)은 2026-09-27부터 공용 components/common/ManualMarkdown
// 으로 뺐다 — ManualDrawer("? 설명" 사이드 패널)와 렌더러를 공유한다. 이 화면은 그 위에 상단 배너·목차·
// mount 시 해시 스크롤만 얹는다. 설정값 치환도 hooks/useResolvedManual로 공유한다.

import React, { useEffect } from 'react';
import { useResolvedManual } from '../../hooks/useResolvedManual';
import { MANUAL_TOC } from '../../constants/manualToc';
import ManualMarkdown from '../common/ManualMarkdown';

function scrollToAnchor(id: string): void {
  window.location.hash = id;
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatBuildDate(): string | null {
  try {
    // vite.config.ts define — 빌드 시점에 고정되는 ISO 문자열. 로컬 dev 서버에서도 서버 시작 시각으로 채워진다.
    const d = new Date(__BUILD_TIME__);
    if (Number.isNaN(d.getTime())) return null;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  } catch {
    return null;
  }
}

const ManualView: React.FC = () => {
  const resolvedMd = useResolvedManual();

  // "? 설명" 링크가 탭을 바꾸기 전에 location.hash를 먼저 정해 둔다 — 이 화면이 mount되는 순간(또는
  // 딥링크 ?tab=manual#앵커로 곧장 들어왔을 때) 그 앵커로 스크롤한다.
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, '');
    if (!id) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [resolvedMd]);

  const buildDate = formatBuildDate();

  return (
    <div className="max-w-4xl mx-auto px-1 sm:px-0 pb-24">
      <div className="mb-4">
        <h1 className="text-lg sm:text-xl font-bold text-white">사용설명서</h1>
        <p className="text-sm text-gray-400 mt-1 leading-relaxed">
          이 설명서는 앱과 함께 자동 업데이트되며, 숫자는 내 설정 기준입니다.
          {buildDate && <span className="text-gray-500"> · 앱 빌드 {buildDate}</span>}
        </p>
      </div>

      <nav aria-label="사용설명서 목차" className="flex flex-wrap gap-1.5 mb-6 pb-4 border-b border-border-subtle">
        {MANUAL_TOC.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => scrollToAnchor(item.id)}
            className="text-xs px-2.5 py-1.5 rounded-full bg-surface-muted text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
          >
            {item.label}
          </button>
        ))}
      </nav>

      <ManualMarkdown markdown={resolvedMd} onAnchorLink={scrollToAnchor} />
    </div>
  );
};

export default ManualView;
