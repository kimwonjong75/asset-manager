// components/common/ManualDrawer.tsx
// ---------------------------------------------------------------------------
// "? 설명"(ManualHelpLink) 클릭 시 뜨는 사이드 패널(2026-09-27) — 화면(또는 열려 있는 모달)을
// 가리지 않고 관련 사용설명서 한 구간만 옆에 띄운다. RULES.md §8 z-index 스케일의 새 토큰
// `z-drawer`(65, 모달 60 위·메뉴 70 아래)를 쓴다.
//
// **모달이 아니다** — 백드롭 없음, body 스크롤 잠금 없음(뒤 화면·열린 모달이 계속 조작 가능해야
// "화면 옆에서 설명서를 본다"는 목적이 성립한다). `role="dialog" aria-modal="false"`.
//
// Esc는 **capture 단계**로 window에 등록하고 preventDefault+stopPropagation한다 — 그래야 이 드로어
// 아래에 열린 Modal(defaultPrevented를 무시하지 않는 document 리스너, bubble 단계)이 같이 닫히지
// 않는다(Modal.tsx는 `e.defaultPrevented`를 보고 무시하므로 이 드로어가 먼저 capture에서 막아야 한다).
//
// 데스크톱(sm+): 우측 고정 패널(h-dvh, w-420px). 모바일(<sm): 하단 시트(max-h-75dvh, safe-area 여백).
// 섹션 없음(anchor가 문서에 없을 때) → 크래시 대신 안내 문구 + "설명서 전체 보기" 버튼.

import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import ManualMarkdown from './ManualMarkdown';
import { useResolvedManual } from '../../hooks/useResolvedManual';
import { extractManualSection } from '../../utils/manualTemplate';
import { MANUAL_TOC } from '../../constants/manualToc';

export interface ManualDrawerProps {
  open: boolean;
  /** 지금 보여줄 문서 앵커 id(docs/터틀_사용설명서.md의 12개 중 하나). */
  anchor: string;
  /** 드로어 안 `#id` 링크를 눌러 다른 섹션으로 전환할 때. */
  onAnchorChange: (id: string) => void;
  onClose: () => void;
  /** "설명서 전체 보기" — 사용설명서 탭으로 이동(호출부가 onBeforeNavigate·해시·탭 전환까지 처리). */
  onOpenFullManual: () => void;
}

function anchorLabel(anchor: string): string {
  return MANUAL_TOC.find(item => item.id === anchor)?.label ?? '사용설명서';
}

const ManualDrawer: React.FC<ManualDrawerProps> = ({ open, anchor, onAnchorChange, onClose, onOpenFullManual }) => {
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Esc — capture 단계 + stopPropagation: 아래 열린 Modal(있다면)의 bubble 단계 Esc 처리를 막아
  // "드로어만 닫히고 모달은 그대로" 결과를 만든다.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [open]);

  // 포커스 — 열리면 닫기 버튼으로, 닫히면 이전 포커스로 복귀(모달과 동일 관례, 트랩은 없음).
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeBtnRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  // 앵커(섹션)가 바뀌면 본문을 위로 되돌린다.
  useEffect(() => {
    if (!open) return;
    bodyRef.current?.scrollTo({ top: 0 });
  }, [open, anchor]);

  // 훅은 조건부로 부를 수 없으므로(react-hooks/rules-of-hooks) `open`이 false여도 항상 호출한다 —
  // 닫혀 있을 때의 계산 비용은 무시할 수준(정규식 치환 1회)이고, 부모는 Modal.tsx와 같은 관례로
  // "항상 마운트해 두고 open으로 렌더만 끈다" 패턴을 쓴다.
  const resolvedMd = useResolvedManual();

  if (!open) return null;

  const section = extractManualSection(resolvedMd, anchor);

  return createPortal(
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      // 포털이라도 React 합성 이벤트는 컴포넌트 트리(=아래 Modal 패널)로 전파된다 — Modal의 Tab 순환
      // 핸들러가 드로어 안 Tab을 가로채 포커스를 모달로 되돌리지 않도록 여기서 끊는다.
      onKeyDown={e => e.stopPropagation()}
      className={
        'fixed z-drawer bg-surface-elevated flex flex-col ' +
        'inset-x-0 bottom-0 max-h-[75dvh] rounded-t-card border-t border-border-subtle shadow-xl pb-[env(safe-area-inset-bottom)] ' +
        'sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-0 sm:h-dvh sm:max-h-none sm:w-[420px] sm:rounded-t-none sm:rounded-none sm:border-t-0 sm:border-l sm:pb-0'
      }
    >
      <div className="shrink-0 flex items-start justify-between gap-3 px-4 py-3.5 border-b border-border-subtle">
        <h2 id={titleId} className="text-base font-semibold text-white">
          {anchorLabel(anchor)}
        </h2>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="shrink-0 -mr-1.5 inline-flex items-center justify-center min-h-9 min-w-9 rounded-md text-gray-400 hover:text-white hover:bg-gray-700/60 transition-colors focus-ring"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
        {section != null ? (
          <ManualMarkdown markdown={section} onAnchorLink={onAnchorChange} />
        ) : (
          <p className="text-sm text-gray-400 leading-relaxed">
            이 항목에 대한 설명을 찾을 수 없습니다. 전체 설명서에서 확인해 주세요.
          </p>
        )}
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-border-subtle">
        <button
          type="button"
          onClick={onOpenFullManual}
          className="w-full text-center text-xs text-primary-light hover:text-primary hover:underline focus-ring rounded py-1.5"
        >
          설명서 전체 보기
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default ManualDrawer;
