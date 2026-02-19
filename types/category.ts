// 카테고리 기본 유형 (거래소 매핑 결정, 고정)
export type CategoryBaseType =
  | 'KOREAN_STOCK'
  | 'US_STOCK'
  | 'FOREIGN_STOCK'
  | 'OTHER_FOREIGN_STOCK'
  | 'KOREAN_BOND'
  | 'US_BOND'
  | 'PHYSICAL_ASSET'
  | 'CRYPTOCURRENCY'
  | 'CASH';

export interface CategoryDefinition {
  id: number;
  name: string;                    // 사용자 편집 가능
  baseType: CategoryBaseType;      // 거래소 매핑 결정 (고정)
  isDefault: boolean;              // 기본 카테고리는 삭제 불가
  sortOrder: number;
}

export interface CategoryStore {
  categories: CategoryDefinition[];
  nextId: number;  // auto-increment
}

// 기본 카테고리 정의
export const DEFAULT_CATEGORIES: CategoryDefinition[] = [
  { id: 1, name: '한국주식', baseType: 'KOREAN_STOCK', isDefault: true, sortOrder: 1 },
  { id: 2, name: '미국주식', baseType: 'US_STOCK', isDefault: true, sortOrder: 2 },
  { id: 3, name: '해외주식', baseType: 'FOREIGN_STOCK', isDefault: true, sortOrder: 3 },
  { id: 4, name: '기타해외주식', baseType: 'OTHER_FOREIGN_STOCK', isDefault: true, sortOrder: 4 },
  { id: 5, name: '한국채권', baseType: 'KOREAN_BOND', isDefault: true, sortOrder: 5 },
  { id: 6, name: '미국채권', baseType: 'US_BOND', isDefault: true, sortOrder: 6 },
  { id: 7, name: '실물자산', baseType: 'PHYSICAL_ASSET', isDefault: true, sortOrder: 7 },
  { id: 8, name: '암호화폐', baseType: 'CRYPTOCURRENCY', isDefault: true, sortOrder: 8 },
  { id: 9, name: '현금', baseType: 'CASH', isDefault: true, sortOrder: 9 },
];

export const DEFAULT_CATEGORY_STORE: CategoryStore = {
  categories: DEFAULT_CATEGORIES,
  nextId: 10,
};

// baseType별 거래소 매핑 (고정, 사용자 수정 불가)
export const EXCHANGE_MAP_BY_BASE_TYPE: Record<CategoryBaseType, string[]> = {
  KOREAN_STOCK: ['KRX (코스피/코스닥)', 'KONEX'],
  US_STOCK: ['NASDAQ', 'NYSE', 'AMEX', 'NYSE American'],
  FOREIGN_STOCK: ['TSE (도쿄)', 'SSE (상하이)', 'SZSE (선전)', 'HKEX (홍콩)'],
  OTHER_FOREIGN_STOCK: ['TSE (도쿄)', 'SSE (상하이)', 'SZSE (선전)', 'HKEX (홍콩)'],
  KOREAN_BOND: ['대한민국 국채'],
  US_BOND: ['미국 국채'],
  PHYSICAL_ASSET: ['KRX 금시장', 'COMEX', 'LBMA', 'NYMEX', 'CME', 'ICE'],
  CRYPTOCURRENCY: ['주요 거래소 (종합)'],
  CASH: ['현금'],
};

// baseType 표시 이름 (카테고리 추가 시 baseType 선택 드롭다운용)
export const BASE_TYPE_LABELS: Record<CategoryBaseType, string> = {
  KOREAN_STOCK: '한국주식',
  US_STOCK: '미국주식',
  FOREIGN_STOCK: '해외주식',
  OTHER_FOREIGN_STOCK: '기타해외주식',
  KOREAN_BOND: '한국채권',
  US_BOND: '미국채권',
  PHYSICAL_ASSET: '실물자산',
  CRYPTOCURRENCY: '암호화폐',
  CASH: '현금',
};

// --- 유틸리티 함수 ---

/** Quick baseType check using DEFAULT_CATEGORIES (covers IDs 1-9, safe fallback for custom) */
export function isBaseType(categoryId: number, baseType: CategoryBaseType): boolean {
  const cat = DEFAULT_CATEGORIES.find(c => c.id === categoryId);
  return cat?.baseType === baseType;
}

/** categoryId → 카테고리 이름 */
export function getCategoryName(categoryId: number, categories: CategoryDefinition[]): string {
  return categories.find(c => c.id === categoryId)?.name ?? `Unknown(${categoryId})`;
}

/** categoryId → baseType */
export function getCategoryBaseType(categoryId: number, categories: CategoryDefinition[]): CategoryBaseType | undefined {
  return categories.find(c => c.id === categoryId)?.baseType;
}

/** 카테고리 이름 → categoryId (마이그레이션용) */
export function getCategoryIdByName(name: string, categories: CategoryDefinition[]): number | undefined {
  return categories.find(c => c.name === name)?.id;
}

/** categoryId → 해당 카테고리의 거래소 목록 */
export function getExchangesForCategory(categoryId: number, categories: CategoryDefinition[]): string[] {
  const baseType = getCategoryBaseType(categoryId, categories);
  return baseType ? EXCHANGE_MAP_BY_BASE_TYPE[baseType] : [];
}

/** 거래소 → baseType 추론 (기존 inferCategoryFromExchange 로직 재사용) */
export function inferBaseTypeFromExchange(exchange: string): CategoryBaseType {
  if (exchange.includes('KRX') || exchange.includes('KONEX')) return 'KOREAN_STOCK';
  if (['NASDAQ', 'NYSE', 'AMEX', 'NYSE American'].includes(exchange)) return 'US_STOCK';
  if (exchange.includes('TSE') || exchange.includes('도쿄')) return 'FOREIGN_STOCK';
  if (exchange.includes('SSE') || exchange.includes('SZSE') || exchange.includes('HKEX') ||
      exchange.includes('상하이') || exchange.includes('선전') || exchange.includes('홍콩')) return 'FOREIGN_STOCK';
  if (exchange.includes('국채')) {
    if (exchange.includes('한국') || exchange.includes('대한민국')) return 'KOREAN_BOND';
    if (exchange.includes('미국')) return 'US_BOND';
  }
  if (exchange.includes('금') || exchange.includes('COMEX') || exchange.includes('LBMA') ||
      exchange.includes('NYMEX') || exchange.includes('CME') || exchange.includes('ICE')) return 'PHYSICAL_ASSET';
  if (exchange.includes('거래소 (종합)')) return 'CRYPTOCURRENCY';
  return 'OTHER_FOREIGN_STOCK';
}

/** 거래소 → categoryId 추론 (해당 baseType의 첫 번째 카테고리 ID 반환) */
export function inferCategoryIdFromExchange(exchange: string, categories: CategoryDefinition[]): number {
  const baseType = inferBaseTypeFromExchange(exchange);
  const cat = categories.find(c => c.baseType === baseType);
  return cat?.id ?? 4; // fallback: 기타해외주식
}

/** ALLOWED 카테고리 (CASH, FOREIGN_STOCK 제외) */
export function getAllowedCategories(categories: CategoryDefinition[]): CategoryDefinition[] {
  return categories
    .filter(c => c.baseType !== 'CASH' && c.baseType !== 'FOREIGN_STOCK')
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** baseType이 특정 유형인지 빠르게 체크하는 헬퍼 */
export function isCashCategory(categoryId: number, categories: CategoryDefinition[]): boolean {
  return getCategoryBaseType(categoryId, categories) === 'CASH';
}

export function isCryptoCategory(categoryId: number, categories: CategoryDefinition[]): boolean {
  return getCategoryBaseType(categoryId, categories) === 'CRYPTOCURRENCY';
}
