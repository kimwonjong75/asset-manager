// components/layouts/ManualView.tsx
// ---------------------------------------------------------------------------
// '사용설명서' 탭 — docs/터틀_사용설명서.md를 그대로 렌더한다(RULES.md §2: 렌더 전용, 계산은
// utils/manualTemplate). 3가지로 "앱이 바뀌면 문서도 자동으로 맞는다":
//   ① 번들 포함 — Vite `?raw` import라 앱을 빌드할 때마다 최신 md가 그대로 딸려온다(복사본 없음).
//   ② 설정값 치환 — {{키}}를 지금 사용자의 실제 터틀 설정(resolveHoldingsSettings)으로 바꾼다.
//   ③ 검사 게이트 — tests/manualIntegrity.ts가 앵커·대괄호 문구·치환 결과를 고정 검증한다
//      (문서가 코드와 어긋나면 npm test가 실패 → 문서를 고치게 만드는 구조).
//
// react-markdown(rehype-raw 없음)은 원본 `<a id="...">`·HTML 주석을 글자 그대로 보여주므로 stripForDisplay로
// 렌더 전에 제거한다(새 의존성 없이 우회). 대신 제목 커스텀 렌더러가 "바로 다음 제목 텍스트"
// 기준으로 실제 DOM에 id를 부여한다(utils/manualTemplate.extractAnchorHeadingMap 참고).
// `[대괄호]` 화면 라벨은 utils/manualTemplate.wrapBracketChips가 인라인 코드 마커(`⟦…⟧`)로 바꿔 두고,
// 아래 `code` 렌더러가 그 마커를 칩으로 그린다.

import React, { useContext, useEffect, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import manualMd from '../../docs/터틀_사용설명서.md?raw';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { resolveHoldingsSettings } from '../../utils/turtleHoldings';
import { renderManualTemplate, extractAnchorHeadingMap, wrapBracketChips, stripForDisplay } from '../../utils/manualTemplate';
import { MANUAL_TOC } from '../../constants/manualToc';

/** react-markdown 자식(children)에서 순수 텍스트만 뽑아낸다(제목 텍스트 → 앵커 id 매칭용). */
function flattenText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return flattenText(props.children);
  }
  return '';
}

function scrollToAnchor(id: string): void {
  window.location.hash = id;
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 제목 텍스트 → 앵커 id 맵(빈 객체 기본값 — Provider 밖에서 쓰이는 일은 없다). 모듈 스코프 컴포넌트가
 *  참조할 유일한 통로 — react-markdown의 `components`는 커스텀 props를 노드에 얹어주지 않는다. */
const ManualHeadingContext = React.createContext<Record<string, string>>({});

/** 제목(h1~h6) 공용 렌더러 — 모듈 스코프에서 한 번만 만든다(렌더 중 컴포넌트 재정의 금지,
 *  react-hooks/static-components). 매 렌더 새 함수를 만들지 않도록 레벨별로 미리 인스턴스화한다. */
function makeHeading(Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6', sizeCls: string): React.FC<React.HTMLAttributes<HTMLHeadingElement>> {
  const Comp: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({ children, ...rest }) => {
    const headingToId = useContext(ManualHeadingContext);
    const text = flattenText(children).trim();
    const id = headingToId[text];
    return React.createElement(Tag, { id, className: `scroll-mt-24 ${sizeCls}`, ...rest }, children);
  };
  Comp.displayName = `ManualHeading_${Tag}`;
  return Comp;
}

const H1 = makeHeading('h1', 'text-xl font-bold text-white mt-8 mb-3 first:mt-0');
const H2 = makeHeading('h2', 'text-lg font-bold text-white mt-8 mb-3 pt-6 border-t border-border-subtle first:border-t-0 first:pt-0 first:mt-0');
const H3 = makeHeading('h3', 'text-base font-semibold text-gray-100 mt-5 mb-2');
const H4 = makeHeading('h4', 'text-base font-semibold text-gray-200 mt-4 mb-1.5');
const H5 = makeHeading('h5', 'text-sm font-semibold text-gray-200 mt-3 mb-1');
const H6 = makeHeading('h6', 'text-sm font-semibold text-gray-300 mt-3 mb-1');

const MANUAL_MARKDOWN_COMPONENTS: Components = {
  h1: H1, h2: H2, h3: H3, h4: H4, h5: H5, h6: H6,
  p: ({ children }) => <p className="text-base leading-relaxed text-gray-300 mb-3">{children}</p>,
  li: ({ children }) => <li className="text-base leading-relaxed text-gray-300">{children}</li>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 mb-3">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 mb-3">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/50 pl-3 text-sm text-gray-400 italic my-3">{children}</blockquote>
  ),
  // ui-constraints.md의 "overflow 래퍼 금지"는 포트폴리오 테이블 sticky header 전용 — 이 화면은
  // sticky thead가 없는 일반 문서 표라 가로 스크롤 래퍼(overflow-x-auto)가 안전하다.
  table: ({ children }) => (
    <div className="overflow-x-auto mb-4 rounded-md border border-border-subtle">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-muted">{children}</thead>,
  th: ({ children }) => <th className="text-left text-gray-200 font-semibold px-3 py-2 border-b border-border-subtle whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="text-gray-300 px-3 py-2 border-b border-border-subtle align-top">{children}</td>,
  code: ({ children }) => {
    const raw = flattenText(children).replace(/\n$/, '');
    if (raw.startsWith('⟦') && raw.endsWith('⟧')) {
      return (
        <span className="inline-flex items-center rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[0.85em] font-medium text-primary-light align-baseline">
          {raw.slice(1, -1)}
        </span>
      );
    }
    return <code className="text-xs bg-surface-muted px-1.5 py-0.5 rounded text-gray-200">{raw}</code>;
  },
  pre: ({ children }) => <pre className="bg-surface-muted rounded-md p-3 text-xs text-gray-300 overflow-x-auto mb-3 whitespace-pre-wrap">{children}</pre>,
  a: ({ href, children }) => {
    if (href && href.startsWith('#')) {
      return (
        <button type="button" onClick={() => scrollToAnchor(href.slice(1))} className="text-primary-light hover:underline">
          {children}
        </button>
      );
    }
    // 외부 문서 참조(docs/*.md)는 앱 밖 파일이라 클릭 가능한 링크로 만들지 않는다 — 텍스트로만 표시.
    return <span className="text-gray-300">{children}</span>;
  },
  hr: () => <hr className="border-border-subtle my-6" />,
  strong: ({ children }) => <strong className="text-gray-100 font-semibold">{children}</strong>,
};

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
  const { data } = usePortfolio();
  const settings = resolveHoldingsSettings(data.turtleSettings.holdings);

  // ② 설정값 치환 — 미해석 키가 있어도 화면은 죽지 않는다(원문 {{키}} 그대로 보임, throw 없음).
  const resolvedMd = useMemo(() => renderManualTemplate(manualMd, settings).text, [settings]);
  const headingToId = useMemo(() => {
    const idToHeading = extractAnchorHeadingMap(resolvedMd);
    const reversed: Record<string, string> = {};
    for (const [id, heading] of Object.entries(idToHeading)) reversed[heading] = id;
    return reversed;
  }, [resolvedMd]);
  const displayMd = useMemo(() => wrapBracketChips(stripForDisplay(resolvedMd)), [resolvedMd]);

  // "? 설명" 링크가 탭을 바꾸기 전에 location.hash를 먼저 정해 둔다 — 이 화면이 mount되는 순간(또는
  // 딥링크 ?tab=manual#앵커로 곧장 들어왔을 때) 그 앵커로 스크롤한다.
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, '');
    if (!id) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayMd가 바뀔 때만(=렌더된 뒤) 재시도
  }, [displayMd]);

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

      <ManualHeadingContext.Provider value={headingToId}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MANUAL_MARKDOWN_COMPONENTS}>
          {displayMd}
        </ReactMarkdown>
      </ManualHeadingContext.Provider>
    </div>
  );
};

export default ManualView;
