import { Asset, PortfolioSnapshot, SellRecord, WatchlistItem, ExchangeRates, Currency, BulkUploadResult, AllocationTargets } from './index';
import type { AlertSettings, AlertResult, AlertDataGap } from './alertRules';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { RiskMatrixRow } from '../utils/riskMatrix';
import type { BackupInfo, BackupSettings } from './backup';
import type { CategoryStore, CategoryBaseType } from './category';
import type { KnowledgeBase, RuleStatusDescriptor } from './knowledge';
import type { GuruSignalMatch, GuruSignalChartTarget, GuruSignalTarget } from '../utils/guruSignalEngine';
import type { PopupDeliveryDiagnosis } from './alertDiagnostics';
import type { TurtleReviewSummary } from '../utils/turtleReview';
import type { GoldPremiumResult } from '../services/goldPremiumService';
import type { ColumnConfig, ColumnKey, FixedColumnWidths, EnrichedAsset, SignalDisplaySettings } from './ui';
import type { MALineConfig } from '../utils/maCalculations';
import type { ActionItem } from './actionQueue';
import type { TurtlePosition, TurtleSettings } from './turtle';
import type { OwnerFilter } from './owner';
import type { AddAssetResult, SellResult, BuyMoreResult } from './assetActionResult';
import type { CleanupDecision } from './cleanup';

export type PortfolioHistory = PortfolioSnapshot[];

export type GlobalPeriod = 'THIS_MONTH' | 'LAST_MONTH' | '1M' | '3M' | '6M' | '1Y' | '2Y' | 'ALL';

export interface PortfolioData {
  assets: Asset[];
  portfolioHistory: PortfolioHistory;
  sellHistory: SellRecord[];
  watchlist: WatchlistItem[];
  exchangeRates: ExchangeRates;
  allocationTargets: AllocationTargets;
  categoryStore: CategoryStore;
  knowledgeBase: KnowledgeBase;
  // 90/10 실행 시스템 (Phase 2)
  actionQueue: ActionItem[];
  turtlePositions: TurtlePosition[];
  turtleSettings: TurtleSettings;
}

/**
 * 교차도메인 원자 커밋용 패치 (Phase 2b-4b-2d) — 지정한 도메인만 갱신하고 **단일 autosave**로 저장.
 * 터틀 실행이 assets+sellHistory+actionQueue+turtlePositions를 한 번에 커밋해 stale sibling 저장 경합을 제거.
 */
export interface PortfolioPatch {
  assets?: Asset[];
  sellHistory?: SellRecord[];
  actionQueue?: ActionItem[];
  turtlePositions?: TurtlePosition[];
  /** 관심종목 (Phase 3c-2 — 대청소 turtle 분류가 assets+watchlist+actionQueue를 한 번에 원자 커밋) */
  watchlist?: WatchlistItem[];
}

export interface PortfolioStatus {
  isLoading: boolean;
  failedAssetIds: Set<string>;
  isSignedIn: boolean;
  needsReAuth: boolean;
  userEmail: string | null;
  isInitializing: boolean;
  error: string | null;
  successMessage: string | null;
  showExchangeRateWarning: boolean;
}

export interface UIState {
  activeTab: 'dashboard' | 'portfolio' | 'analytics' | 'watchlist' | 'replay' | 'execution' | 'cleanup' | 'guide' | 'settings';
  globalPeriod: GlobalPeriod;
  /** 계정 뷰 필터 (통합/원종/유선) — 대시보드·포트폴리오 **표시 계층 전용**. 원본 data.assets는 절대 거르지 않음(저장 유실 방지). 매도통계·히스토리는 통합 기준 유지(1차 한계) */
  accountView: OwnerFilter;
  /** 대시보드 자산구분 필터. 숫자=코어 버킷의 해당 카테고리만, 'SATELLITE'=투더문 버킷 전체 (카테고리는 코어의 배분 축·투더문은 덩어리 취급) */
  dashboardFilterCategory: number | 'ALL' | 'SATELLITE';
  filterCategory: number | 'ALL';
  filterAlerts: boolean;
  searchQuery: string;
  sellAlertDropRate: number;
  alertSettings: AlertSettings;
  focusedAssetId: string | null;
  focusedWatchItemId: string | null;
  /** 포트폴리오 표시 임계값 (KRW) — 토글 활성 시 평가총액이 이 값 미만인 자산 숨김. 기본 1,000,000 */
  lowValueThreshold: number;
  /** 포트폴리오 테이블 컬럼 표시/순서 설정 (데스크탑 전용, 양끝 name/actions 제외) */
  columnConfig: ColumnConfig[];
  /** 양끝 고정 컬럼 중 사용자 리사이즈 가능한 컬럼의 너비 (현재 name만) */
  fixedColumnWidths: FixedColumnWidths;
  /** 개별 차트 이동평균선 6슬롯 설정 (기간/색/표시여부) — 차트 표시 전용, 알림/스마트필터 MA와 무관 */
  chartMAConfigs: MALineConfig[];
  /** 신호 표시 설정 (Phase 5 — 신호 다이어트). 참고형 신호의 표시 위치·크기만 제어, 계산/발화 무관 */
  signalDisplay: SignalDisplaySettings;
}

export interface ModalState {
  editingAsset: Asset | null;
  sellingAsset: Asset | null;
  buyingAsset: Asset | null;
  bulkUploadOpen: boolean;
  addAssetOpen: boolean;
  assistantOpen: boolean;
  editingWatchItem: WatchlistItem | null;
  addWatchItemOpen: boolean;
  editingSellRecord: SellRecord | null;
  /** 터틀 주문 실행 모달 대상 (Phase 2b-4b-2-ii). null=닫힘. 전용 TurtleExecuteModal만 사용 */
  turtleExecAction: ActionItem | null;
  /** 대청소 청산 실행 모달 대상 (Phase 3d-2). null=닫힘. 전용 CleanupExecuteModal만 사용 */
  cleanupExecAction: ActionItem | null;
  /** 리밸런싱 실행 모달 대상 (Phase 4c-2). null=닫힘. 전용 RebalanceExecuteModal만 사용 */
  rebalanceExecAction: ActionItem | null;
}

export interface DerivedState {
  totalValue: number;
  alertCount: number;
  enrichedMap: Map<string, EnrichedIndicatorData>;
  /** 메트릭 enrich된 포트폴리오 자산 — 알림/진단이 metrics·indicators까지 필요로 함 (Context 레벨 1회 계산) */
  enrichedAssets: EnrichedAsset[];
  isEnrichedLoading: boolean;
  alertResults: AlertResult[];
  /** 종합 리스크 매트릭스 — 클라이맥스 + 디스트리뷰션 합성 티어 (위험 우선 정렬됨) */
  riskMatrix: RiskMatrixRow[];
  /** fail-safe(매도 data-gap) — 매도 규칙이 데이터 누락으로 판정 불가(unknown)인 종목. 발화 아님, '수동 확인' 주의 노출용 */
  sellDataGaps: AlertDataGap[];
  /** 구루 신호 엔진 매칭 — 활성 지식 규칙(typed condition)을 종목별 평가한 결과 */
  guruSignals: GuruSignalMatch[];
  /** 신호 평가/진단 대상 종목(포트폴리오+관심종목) — 신호 카드와 진단 패널이 공유하는 단일 소스 */
  guruSignalTargets: GuruSignalTarget[];
  /** 신호 종목별 차트 props 맵(assetId 키) — GuruSignalCard 인라인 차트용 */
  guruSignalChartTargets: Record<string, GuruSignalChartTarget>;
  /** 발화한 구루 신호별 데이터 품질 캐비엇 (key=`${ruleId}__${assetId}`) — firing-partial이면 '일부 데이터 기준' 표시 */
  guruSignalCaveats: Map<string, RuleStatusDescriptor>;
  /** 자동 브리핑 팝업 게이트 진단 (규칙 발화와 직교 — 알림 진단 패널이 표시) */
  autoPopupDiagnosis: PopupDeliveryDiagnosis;
  /** 터틀 실행 요약 (자동 검토 Phase A/B) — 상단 배지 '실행 M'·브리핑 실행 카드가 소비. 읽기 전용(저장 없음) */
  actionQueueSummary: TurtleReviewSummary;
  showAlertPopup: boolean;
  // 백업
  backupList: BackupInfo[];
  backupSettings: BackupSettings;
  isBackingUp: boolean;
  // 금 김치프리미엄
  goldPremium: GoldPremiumResult | null;
  isGoldPremiumLoading: boolean;
  goldPremiumError: string | null;
}

export interface PortfolioActions {
  // 저장/내보내기/가져오기
  saveToDrive: () => Promise<void>;
  exportJson: (fileName?: string) => Promise<void>;
  importJsonPrompt: () => void;
  exportCsv: () => Promise<void>;

  // 인증
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;

  // 환율/시세
  setExchangeRates: (rates: ExchangeRates) => void;
  refreshAllPrices: (force?: boolean) => Promise<void>;
  refreshSelectedPrices: (ids: string[]) => Promise<void>;
  refreshOnePrice: (id: string) => Promise<void>;
  refreshWatchlistPrices: () => Promise<void>;

  // 자산
  addAsset: (asset: Asset) => Promise<AddAssetResult>;
  updateAsset: (asset: Asset) => Promise<void>;
  togglePinAsset: (id: string) => void;
  deleteAsset: (id: string) => void;
  confirmSell: (id: string, sellDate: string, sellPrice: number, sellQuantity: number, currency: Currency) => Promise<SellResult>;
  /** 매도 기록 편집: 입력값은 자산 통화 기준 단가(`sellPriceSettlement`). 날짜 변경 시 환율 재조회 */
  editSellRecord: (recordId: string, patch: { sellDate?: string; sellPriceSettlement?: number; sellQuantity?: number }) => Promise<void>;
  /** 매도 기록 삭제 — `sellHistory` + 자산의 `sellTransactions` 양쪽에서 제거. 보유수량 복구하지 않음 */
  deleteSellRecord: (recordId: string) => void;
  confirmBuyMore: (id: string, buyDate: string, buyPrice: number, buyQuantity: number) => Promise<BuyMoreResult>;
  addSelectedToWatchlist: (assets: Asset[]) => void;

  // 관심종목
  addWatchItem: (item: Omit<WatchlistItem, 'id' | 'currentPrice' | 'priceOriginal' | 'currency' | 'previousClosePrice' | 'highestPrice'>) => void;
  updateWatchItem: (item: WatchlistItem) => void;
  deleteWatchItem: (id: string) => void;
  bulkDeleteWatchItems: (ids: string[]) => void;
  togglePinWatchItem: (id: string) => void;

  // 메시지
  clearError: () => void;
  clearSuccessMessage: () => void;

  // 파일 업로드
  uploadCsv: (file: File) => Promise<BulkUploadResult>;

  // UI/모달
  updateAlertSettings: (settings: AlertSettings) => void;
  dismissAlertPopup: () => void;
  showBriefingPopup: () => void;
  setActiveTab: (tab: UIState['activeTab']) => void;
  setFocusedAssetId: (id: string | null) => void;
  setFocusedWatchItemId: (id: string | null) => void;
  setGlobalPeriod: (p: GlobalPeriod) => void;
  /** 계정 뷰 필터 변경 (통합/원종/유선) — localStorage 영속. 표시 계층만 영향 */
  setAccountView: (f: OwnerFilter) => void;
  setDashboardFilterCategory: (c: UIState['dashboardFilterCategory']) => void;
  setFilterCategory: (c: UIState['filterCategory']) => void;
  setFilterAlerts: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  setSellAlertDropRate: (n: number) => void;
  setLowValueThreshold: (n: number) => void;
  /** 포트폴리오 테이블 컬럼 설정 갱신 — visible/순서 모두 포함. localStorage에 영속화 */
  setColumnConfig: (config: ColumnConfig[]) => void;
  /** 컬럼 설정을 DEFAULT_COLUMN_CONFIG로 초기화 — visible/순서/너비 모두 리셋 */
  resetColumnConfig: () => void;
  /** 중간 컬럼 너비 갱신 (px). MIN_COLUMN_WIDTH(80px) 미만 자동 클램프 */
  setColumnWidth: (key: ColumnKey, width: number) => void;
  /** 고정 컬럼(name) 너비 갱신 (px). MIN_COLUMN_WIDTH(80px) 미만 자동 클램프 */
  setFixedColumnWidth: (key: keyof FixedColumnWidths, width: number) => void;
  /** 개별 차트 MA 슬롯 설정 갱신 (기간/표시여부). 기간은 1~400으로 클램프, localStorage 영속 */
  setChartMAConfigs: (configs: MALineConfig[]) => void;
  /** 차트 MA 슬롯 설정을 DEFAULT_MA_CONFIGS로 초기화 */
  resetChartMAConfigs: () => void;
  /** 신호 표시 설정 부분 갱신 (Phase 5). 지정 필드만 병합 후 localStorage 영속 — 표시 계층만 */
  setSignalDisplay: (patch: Partial<SignalDisplaySettings>) => void;
  updateAllocationTargets: (targets: AllocationTargets) => void;
  openEditModal: (asset: Asset) => void;
  closeEditModal: () => void;
  openSellModal: (asset: Asset) => void;
  closeSellModal: () => void;
  openBuyModal: (asset: Asset) => void;
  closeBuyModal: () => void;
  openBulkUpload: () => void;
  closeBulkUpload: () => void;
  openAddAsset: () => void;
  closeAddAsset: () => void;
  openAssistant: () => void;
  closeAssistant: () => void;
  openAddWatchItem: () => void;
  closeAddWatchItem: () => void;
  openEditWatchItem: (item: WatchlistItem) => void;
  closeEditWatchItem: () => void;
  openEditSellRecord: (record: SellRecord) => void;
  closeEditSellRecord: () => void;
  /** 터틀 주문 실행 모달 열기/닫기 (Phase 2b-4b-2-ii). 여는 것만으로는 아무 상태도 바뀌지 않음 */
  openTurtleExecution: (action: ActionItem) => void;
  closeTurtleExecution: () => void;
  /** 대청소 청산 실행 모달 열기/닫기 (Phase 3d-2). 여는 것만으로는 아무 상태도 바뀌지 않음 */
  openCleanupExecution: (action: ActionItem) => void;
  closeCleanupExecution: () => void;
  /** 리밸런싱 실행 모달 열기/닫기 (Phase 4c-2). 여는 것만으로는 아무 상태도 바뀌지 않음 */
  openRebalanceExecution: (action: ActionItem) => void;
  closeRebalanceExecution: () => void;

  // 카테고리 관리
  addCategory: (name: string, baseType: CategoryBaseType) => void;
  renameCategory: (id: number, newName: string) => void;
  deleteCategory: (id: number, reassignToId: number) => void;

  // 지식 베이스 (구루 지식 DB) — 상태 갱신 + Drive 자동 저장
  updateKnowledgeBase: (kb: KnowledgeBase) => void;

  // 90/10 실행 시스템 (Phase 2) — 상태 갱신 + Drive 자동 저장
  updateActionQueue: (queue: ActionItem[]) => void;
  updateTurtlePositions: (positions: TurtlePosition[]) => void;
  updateTurtleSettings: (settings: TurtleSettings) => void;
  /** 교차도메인 원자 커밋 — 지정 도메인 set + 단일 autosave (터틀 실행의 저장 경합 방지) */
  commitPortfolioPatch: (patch: PortfolioPatch) => void;
  /** 대청소 일괄 분류 저장 (Phase 3b) — assetId별 결정을 자산에 적용 후 단일 커밋. 결정 없는 자산 불변 */
  saveCleanupDecisions: (decisions: Record<string, CleanupDecision>) => void;

  // 금 김치프리미엄
  refreshGoldPremium: () => Promise<void>;

  // 백업
  performBackup: () => Promise<void>;
  loadBackupList: () => Promise<void>;
  restoreBackup: (fileId: string) => Promise<void>;
  deleteBackup: (fileId: string) => Promise<void>;
  updateBackupSettings: (settings: BackupSettings) => void;
}

export interface PortfolioContextValue {
  data: PortfolioData;
  status: PortfolioStatus;
  ui: UIState;
  modal: ModalState;
  derived: DerivedState;
  actions: PortfolioActions;
}
