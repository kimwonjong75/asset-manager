// utils/columnConfig.ts
// ---------------------------------------------------------------------------
// 포트폴리오 테이블 컬럼 설정 — 기본값 + 저장본 머지 (순수 함수, Stage D1).
//   · 기본 표시 컬럼 5개(현재가·어제대비·평가총액·수익률·최고가 대비). 나머지 6개는 키는 유지하되 숨김.
//   · **저장된 설정은 건드리지 않는다** — 새 기본값은 (a) 저장본이 없는 첫 사용, (b) "기본값으로 초기화",
//     (c) 저장본에 없는 신규 키를 뒤에 붙일 때만 쓰인다.
//   · mergeColumnConfig 는 PortfolioContext 에서 옮겨 온 것으로 동작 동일:
//       저장본의 순서·visible·width 보존 / 알 수 없는 키 제거 / 누락 키는 기본값(visible 포함)으로 뒤에 추가.
// ---------------------------------------------------------------------------

import { DEFAULT_COLUMN_CONFIG, type ColumnConfig, type ColumnKey } from '../types/ui';

export { DEFAULT_COLUMN_CONFIG };

/** 기본으로 보이는 컬럼 키(표시 순서) — DEFAULT_COLUMN_CONFIG 에서 파생 */
export const DEFAULT_VISIBLE_COLUMN_KEYS: readonly ColumnKey[] = DEFAULT_COLUMN_CONFIG.filter(c => c.visible).map(c => c.key);

/** 초기화용 새 배열(호출부가 변형해도 상수가 오염되지 않도록 항목까지 복사) */
export function getDefaultColumnConfig(): ColumnConfig[] {
  return DEFAULT_COLUMN_CONFIG.map(c => ({ ...c }));
}

/**
 * 저장된 컬럼 설정과 현재 기본값을 머지.
 *  - 저장본에 없는 키는 기본값(visible 기본값 포함) 그대로 뒤에 추가
 *  - 저장본의 알 수 없는 키는 제거
 *  - 저장본 항목(순서·visible·width)은 원형 유지
 */
export function mergeColumnConfig(stored: ColumnConfig[]): ColumnConfig[] {
  const validKeys = new Set<string>(DEFAULT_COLUMN_CONFIG.map(c => c.key));
  const cleaned = stored.filter(c => validKeys.has(c.key));
  const seen = new Set<string>(cleaned.map(c => c.key));
  const missing = DEFAULT_COLUMN_CONFIG.filter(c => !seen.has(c.key));
  return [...cleaned, ...missing];
}

/**
 * 컬럼이 숨겨질 때 해당 컬럼이 현재 정렬 기준인지 — 수익률 컬럼은 수익률/평가손익 2개 정렬키를 돈다.
 * (정렬 해제 판정 전용. 표시 계층에서만 사용)
 */
export function isSortKeyOfColumn(sortKey: string | null | undefined, column: ColumnKey): boolean {
  if (!sortKey) return false;
  if (column === 'returnPercentage') return sortKey === 'returnPercentage' || sortKey === 'profitLossKRW';
  return sortKey === column;
}
