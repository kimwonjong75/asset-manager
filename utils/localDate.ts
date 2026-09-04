// utils/localDate.ts
// 로컬(브라우저) 달력일 기준 'YYYY-MM-DD'.
//
// 왜 필요한가: `new Date().toISOString().slice(0, 10)`는 UTC 날짜다. KST 자정~09:00
// 사이에는 UTC로 아직 "어제"라서, 하루 1회 게이팅(시세 갱신/팝업/백업/터틀 자동검토)이
// 이 시간대에 재접속하면 "하루가 안 넘어간 것"으로 오판된다(RULES.md §8, P4 계획서 §5).
// 순수 함수 — Date 주입 가능(테스트용), 브라우저 API 의존 없음(Node/GAS 겸용).
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
