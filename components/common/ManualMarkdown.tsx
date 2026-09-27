// components/common/ManualMarkdown.tsx
// ---------------------------------------------------------------------------
// "터틀 사용설명서" 마크다운 렌더러(2026-09-27, 렌더 전용) — 원래 components/layouts/ManualView.tsx
// 안에 있던 module-scope 렌더러(MANUAL_MARKDOWN_COMPONENTS·ManualHeadingContext·flattenText)를
// 그대로 빼낸 것이다. ManualView('사용설명서' 탭)와 ManualDrawer(모달/화면 옆 사이드 패널)가
// 둘 다 이 컴포넌트로 렌더한다 — 스타일·칩·표·앵커 처리 로직은 단 한 곳에만 있다.
//
// props.markdown 은 "이미 설정값이 치환된"(renderManualTemplate 결과) 원문이어야 한다 — 이 컴포넌트가
// 여기서 stripForDisplay·wrapBracketChips·extractAnchorHeadingMap을 전부 적용해 렌더한다(호출부는
// 원본/치환 결과만 넘기면 된다). `#id` 링크를 눌렀을 때 무엇을 할지는 props.onAnchorLink로 위임한다
// (ManualView는 페이지 안 스크롤, ManualDrawer는 드로어 안 섹션 전환 — 소비처마다 다르다).

import React, { useContext, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { extractAnchorHeadingMap, wrapBracketChips, stripForDisplay } from '../../utils/manualTemplate';

export interface ManualMarkdownProps {
  /** renderManualTemplate으로 설정값이 치환된 원문(치환 전이어도 동작은 하지만 {{키}}가 그대로 보인다). */
  markdown: string;
  /** 본문의 `#id` 링크 클릭 시 호출(스크롤/섹션 전환 등은 호출부 책임 — 이 컴포넌트는 모른다). */
  onAnchorLink: (id: string) => void;
}

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

/** 제목 텍스트 → 앵커 id 맵(빈 객체 기본값 — Provider 밖에서 쓰이는 일은 없다). 모듈 스코프 컴포넌트가
 *  참조할 유일한 통로 — react-markdown의 `components`는 커스텀 props를 노드에 얹어주지 않는다. */
const ManualHeadingContext = React.createContext<Record<string, string>>({});

/** `#id` 링크 클릭 콜백 통로 — 위와 같은 이유(모듈 스코프 `a` 렌더러가 호출부마다 다른 동작을 하려면
 *  context로 주입하는 수밖에 없다. 렌더 중 컴포넌트 재정의 금지라 함수를 그때그때 새로 만들 수 없다). */
const ManualAnchorLinkContext = React.createContext<(id: string) => void>(() => {});

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

const ManualLink: React.FC<{ href?: string; children?: React.ReactNode }> = ({ href, children }) => {
  const onAnchorLink = useContext(ManualAnchorLinkContext);
  if (href && href.startsWith('#')) {
    return (
      <button type="button" onClick={() => onAnchorLink(href.slice(1))} className="text-primary-light hover:underline">
        {children}
      </button>
    );
  }
  // 외부 문서 참조(docs/*.md)는 앱 밖 파일이라 클릭 가능한 링크로 만들지 않는다 — 텍스트로만 표시.
  return <span className="text-gray-300">{children}</span>;
};

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
  a: ManualLink,
  hr: () => <hr className="border-border-subtle my-6" />,
  strong: ({ children }) => <strong className="text-gray-100 font-semibold">{children}</strong>,
};

const ManualMarkdown: React.FC<ManualMarkdownProps> = ({ markdown, onAnchorLink }) => {
  const headingToId = useMemo(() => {
    const idToHeading = extractAnchorHeadingMap(markdown);
    const reversed: Record<string, string> = {};
    for (const [id, heading] of Object.entries(idToHeading)) reversed[heading] = id;
    return reversed;
  }, [markdown]);
  const displayMd = useMemo(() => wrapBracketChips(stripForDisplay(markdown)), [markdown]);

  return (
    <ManualHeadingContext.Provider value={headingToId}>
      <ManualAnchorLinkContext.Provider value={onAnchorLink}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MANUAL_MARKDOWN_COMPONENTS}>
          {displayMd}
        </ReactMarkdown>
      </ManualAnchorLinkContext.Provider>
    </ManualHeadingContext.Provider>
  );
};

export default ManualMarkdown;
