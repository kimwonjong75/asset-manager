// utils/manualTemplate.ts
// ---------------------------------------------------------------------------
// "터틀 사용설명서"(docs/터틀_사용설명서.md) 렌더 보조 — 전부 순수 함수, 부수효과 없음.
// 원본 md는 components/layouts/ManualView.tsx가 Vite `?raw` import로 가져와 이 파일에 넘긴다
// (파일 I/O는 이 utils가 하지 않는다 — RULES.md §2 utils=순수 함수 원칙).
//
// 문서 표기 규약(docs/터틀_사용설명서.md 상단 안내와 동일):
//   · `{{키}}`      — DEFAULT_TURTLE_HOLDINGS_SETTINGS 필드명 자리표시자 → renderManualTemplate이 치환
//   · `<a id="x">`  — 앵커(총 12개, tests/manualIntegrity.ts가 개수·존재를 고정 검증)
//   · `[대괄호]`     — 화면 버튼·라벨 이름(마크다운 링크 `[텍스트](url)`는 제외) → extractBracketLabels

import type { TurtleHoldingsSettings, PyramidSpacingMode } from '../types/turtleHoldings';

/** 설정 화면(TurtleHoldingsSettingsSection)의 세그먼트 버튼 문구와 반드시 동일하게 맞춘다. */
export const PYRAMID_SPACING_LABELS: Record<PyramidSpacingMode, string> = {
  '2R': '2R(강의식 기본)',
  halfN: '½N(원조)',
  custom: '직접 입력',
};

/** `{{키}}` 하나를 표시 문자열로 바꾼다. 모르는 키면 null(원문 유지 신호). */
function formatSettingValue(key: string, settings: TurtleHoldingsSettings): string | null {
  switch (key) {
    case 'entryLookback': return String(settings.entryLookback);
    case 'exitLookback': return String(settings.exitLookback);
    case 'maPeriod': return String(settings.maPeriod);
    case 'atrTrailMultiple': return String(settings.atrTrailMultiple);
    case 'stopMultipleN': return String(settings.stopMultipleN);
    case 'riskPerUnitPct': return String(settings.riskPerUnitPct);
    case 'maxUnitsPerPosition': return String(settings.maxUnitsPerPosition);
    case 'pyramidSizeMultiplier': return String(settings.pyramidSizeMultiplier);
    case 'positionCapPct': return String(settings.positionCapPct);
    case 'maxTotalRiskPct': return String(settings.maxTotalRiskPct);
    // 천단위 구분 — CLAUDE.md 작업 지시 예시(minOrderKRW → 50,000)와 동일 표기.
    case 'minOrderKRW': return settings.minOrderKRW.toLocaleString('ko-KR');
    case 'drawdownScalingEnabled': return settings.drawdownScalingEnabled ? '켜짐' : '꺼짐';
    case 'pyramidSpacing': return PYRAMID_SPACING_LABELS[settings.pyramidSpacing];
    default: return null;
  }
}

export interface RenderManualResult {
  /** {{키}} 가 전부(또는 가능한 만큼) 치환된 본문 */
  text: string;
  /** 해석하지 못한 키 이름(중복 제거) — 원문 `{{키}}` 그대로 남는다. 정상 흐름에서는 항상 빈 배열. */
  unresolvedKeys: string[];
}

/** `{{키}}` 자리표시자를 사용자의 현재 터틀 설정값으로 치환한다(순수 — 이 함수는 어떤 설정을 넘길지 모른다;
 *  기본값 폴백은 호출부가 `resolveHoldingsSettings(data.turtleSettings.holdings)`로 미리 해서 넘긴다). */
export function renderManualTemplate(md: string, settings: TurtleHoldingsSettings): RenderManualResult {
  const unresolved = new Set<string>();
  const text = md.replace(/\{\{([a-zA-Z]+)\}\}/g, (whole: string, key: string) => {
    const value = formatSettingValue(key, settings);
    if (value === null) { unresolved.add(key); return whole; }
    return value;
  });
  return { text, unresolvedKeys: [...unresolved] };
}

/** 문서에 실제 존재하는 `<a id="...">` 앵커 id 목록(중복 제거, 등장 순서 유지). */
export function extractAnchors(md: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<a id="([a-zA-Z0-9_-]+)"><\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
  }
  return out;
}

/**
 * 앵커 id → 바로 다음 제목(#~######) 텍스트 매핑(순수). react-markdown은 원본 `<a id>` 태그를 그대로
 * 렌더하지 않으므로(HTML raw 노드, rehype-raw 없이는 사라짐 — 새 의존성 추가 없이 우회), ManualView가
 * 제목 커스텀 렌더러에서 이 맵을 거꾸로(제목 텍스트 → id) 찾아 실제 DOM에 id를 부여해 앵커 스크롤을 만든다.
 */
export function extractAnchorHeadingMap(md: string): Record<string, string> {
  const lines = md.split('\n');
  const map: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const anchorMatch = lines[i].match(/<a id="([a-zA-Z0-9_-]+)"><\/a>/);
    if (!anchorMatch) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (!line) continue;
      const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
      if (headingMatch) map[anchorMatch[1]] = headingMatch[1].trim();
      break;
    }
  }
  return map;
}

/**
 * 화면 버튼·라벨을 가리키는 `[텍스트]` 문구 목록(중복 제거, 등장 순서 유지).
 * 마크다운 링크 `[텍스트](url)`(뒤에 바로 `(`가 오는 경우)는 제외한다 — 문서 내 상호 참조일 뿐
 * 화면 라벨이 아니다(예: `[터틀 정리](#cleanup)`).
 */
export function extractBracketLabels(md: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[([^\]\n]+)\](?!\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
  }
  return out;
}

/** 코드펜스(```)/인라인 코드(`)/제목 줄(#~######) — 칩 변환에서 보호할 구간 하나의 정규식. */
const PROTECTED_SEGMENT_RE = /(```[\s\S]*?```|`[^`\n]+`|^#{1,6}[^\n]*$)/gm;

/**
 * `[텍스트]`(마크다운 링크 제외)를 인라인 칩 마커 `` `⟦텍스트⟧` ``로 바꾼다 — ManualView의 `code`
 * 렌더러가 `⟦…⟧`를 감지해 버튼처럼 보이는 칩으로 그린다. 코드펜스·인라인 코드·제목 줄은 손대지 않는다
 * (제목 줄은 `extractAnchorHeadingMap`의 앵커 매핑 기준이라 원문이 보존돼야 한다).
 */
export function wrapBracketChips(md: string): string {
  const segments = md.split(PROTECTED_SEGMENT_RE);
  return segments
    .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(/\[([^\]\n]+)\](?!\()/g, '`⟦$1⟧`')))
    .join('');
}

/**
 * 화면 표시용 정리(Advisor 2026-09-27) — react-markdown(rehype-raw 없음)은 원문 HTML을 글자 그대로 보여주므로
 * 앵커 줄(`<a id="…"></a>`)과 HTML 주석(관리자 메모)을 렌더 전에 제거한다. 앵커 id는 extractAnchorHeadingMap이
 * 원본에서 따로 뽑아 제목에 부여하므로 제거해도 이동은 그대로 동작한다. 원본(md)은 무변경 — 검사 게이트는 원본을 본다.
 */
export function stripForDisplay(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*<a id="[^"]*"><\/a>[ \t]*\r?\n?/gm, '');
}
