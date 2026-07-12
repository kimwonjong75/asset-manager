// utils/parsePortfolioPayload.ts
// ---------------------------------------------------------------------------
// portfolio.json / 백업 페이로드 문자열을 전 도메인 타입 구조로 파싱하는 순수 함수.
// Drive 로드(useGoogleDriveSync.loadFromGoogleDrive)와 백업 복원이 동일한 스키마를
// 사용하므로, 이 파서를 공유해 "일부 도메인만 복원되는" 유실 버그(P2)를 제거한다.
//
// 순수: localStorage / window 접근 없음. 배열 필드는 비배열이면 []/undefined로 방어.
// 잘못된 JSON은 JSON.parse가 throw → 호출측에서 try-catch로 처리.
// (tableLayout localStorage 반영 + CustomEvent dispatch는 부수효과라 훅에 남는다.)

import { Asset, PortfolioSnapshot, SellRecord, WatchlistItem, ExchangeRates, AllocationTargets } from '../types';
import type { CategoryStore } from '../types/category';
import type { KnowledgeBase } from '../types/knowledge';
import type { ActionItem } from '../types/actionQueue';
import type { TurtlePosition, TurtleSettings } from '../types/turtle';
import type { ColumnConfig, FixedColumnWidths } from '../types/ui';

// 신규 백업의 테이블 레이아웃 묶음 (columns + fixedWidths).
export interface ParsedTableLayout {
  columns?: ColumnConfig[];
  fixedWidths?: FixedColumnWidths;
}

// 전 도메인 파싱 결과. LoadedData(useGoogleDriveSync)의 옵셔널 규약을 따르되,
// 백업 전용 UI 필드(tableLayout / columnConfig[레거시] / lastUpdateDate)까지 포함한다.
export interface ParsedPortfolioPayload {
  assets: Asset[];
  portfolioHistory: PortfolioSnapshot[];
  sellHistory: SellRecord[];
  watchlist: WatchlistItem[];
  exchangeRates?: ExchangeRates;
  allocationTargets?: AllocationTargets;
  sellAlertDropRate?: number;
  categoryStore?: CategoryStore;
  knowledgeBase?: KnowledgeBase;
  actionQueue?: ActionItem[];
  turtlePositions?: TurtlePosition[];
  turtleSettings?: TurtleSettings;
  tableLayout?: ParsedTableLayout;
  columnConfig?: ColumnConfig[]; // 레거시 백업(구 버전 클라이언트 호환)
  lastUpdateDate?: string;
}

// 배열/null이 아닌 순수 객체 판별.
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * portfolio.json / 백업 페이로드 문자열을 전 도메인 구조로 파싱한다.
 * @throws SyntaxError 잘못된 JSON일 때 (JSON.parse가 던짐)
 */
export function parsePortfolioPayload(json: string): ParsedPortfolioPayload {
  const raw = JSON.parse(json);
  const data: Record<string, unknown> = isPlainObject(raw) ? raw : {};

  // 배열 도메인 — 배열이 아니면 [] (오염된 페이로드 방어)
  const assets = Array.isArray(data.assets) ? (data.assets as Asset[]) : [];
  const portfolioHistory = Array.isArray(data.portfolioHistory) ? (data.portfolioHistory as PortfolioSnapshot[]) : [];
  const sellHistory = Array.isArray(data.sellHistory) ? (data.sellHistory as SellRecord[]) : [];
  const watchlist = Array.isArray(data.watchlist) ? (data.watchlist as WatchlistItem[]) : [];

  // 옵셔널 객체/스칼라 도메인 — 없거나 형이 안 맞으면 undefined
  const exchangeRates = isPlainObject(data.exchangeRates) ? (data.exchangeRates as unknown as ExchangeRates) : undefined;
  // 레거시 allocationTargets(weights 없이 카테고리→비중 맵)도 그대로 통과 — 마이그레이션은 로드 파이프라인 담당
  const allocationTargets = isPlainObject(data.allocationTargets) ? (data.allocationTargets as unknown as AllocationTargets) : undefined;
  const sellAlertDropRate = typeof data.sellAlertDropRate === 'number' ? data.sellAlertDropRate : undefined;
  const categoryStore = isPlainObject(data.categoryStore) ? (data.categoryStore as unknown as CategoryStore) : undefined;
  const knowledgeBase = isPlainObject(data.knowledgeBase) ? (data.knowledgeBase as unknown as KnowledgeBase) : undefined;
  const actionQueue = Array.isArray(data.actionQueue) ? (data.actionQueue as ActionItem[]) : undefined;
  const turtlePositions = Array.isArray(data.turtlePositions) ? (data.turtlePositions as TurtlePosition[]) : undefined;
  const turtleSettings = isPlainObject(data.turtleSettings) ? (data.turtleSettings as unknown as TurtleSettings) : undefined;

  // 테이블 레이아웃(신규) — columns 배열 / fixedWidths 객체만 보존
  let tableLayout: ParsedTableLayout | undefined;
  if (isPlainObject(data.tableLayout)) {
    const tl = data.tableLayout;
    tableLayout = {
      columns: Array.isArray(tl.columns) ? (tl.columns as ColumnConfig[]) : undefined,
      fixedWidths: isPlainObject(tl.fixedWidths) ? (tl.fixedWidths as FixedColumnWidths) : undefined,
    };
  }

  const columnConfig = Array.isArray(data.columnConfig) ? (data.columnConfig as ColumnConfig[]) : undefined;
  const lastUpdateDate = typeof data.lastUpdateDate === 'string' ? data.lastUpdateDate : undefined;

  return {
    assets,
    portfolioHistory,
    sellHistory,
    watchlist,
    exchangeRates,
    allocationTargets,
    sellAlertDropRate,
    categoryStore,
    knowledgeBase,
    actionQueue,
    turtlePositions,
    turtleSettings,
    tableLayout,
    columnConfig,
    lastUpdateDate,
  };
}
