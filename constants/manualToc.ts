// constants/manualToc.ts
// ---------------------------------------------------------------------------
// '사용설명서'(manual 탭) 목차 — docs/터틀_사용설명서.md의 12개 앵커(<a id="...">)에 초보자가
// 이해하기 쉬운 제목을 붙인 것. id 목록은 tests/manualIntegrity.ts가
// `extractAnchors(md)`(utils/manualTemplate)와 정확히 같은 집합인지 고정 검증한다 — 문서에서
// 앵커를 추가/삭제하면 이 표도 같이 고쳐야 하고, 안 고치면 npm test가 실패한다(의도된 게이트).

export interface ManualTocEntry {
  id: string;
  label: string;
}

export const MANUAL_TOC: readonly ManualTocEntry[] = [
  { id: 'summary', label: '한눈에 보기' },
  { id: 'routine', label: '매일 할 일' },
  { id: 'today', label: '오늘 할 일 카드 보는 법' },
  { id: 'sell', label: '팔 때 (매도 기록)' },
  { id: 'rebuy', label: '다시 살 때 / 추가 매수' },
  { id: 'stopcheck', label: '손절선 확인' },
  { id: 'cleanup', label: '터틀 정리 화면' },
  { id: 'newstock', label: '새 종목 추가하기' },
  { id: 'settings', label: '설정값 알아보기' },
  { id: 'kakao', label: '카톡 알림 종류' },
  { id: 'faq', label: '자주 묻는 질문' },
  { id: 'limits', label: '알아둘 한계' },
];
