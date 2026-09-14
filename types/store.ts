import { Asset, PortfolioSnapshot, SellRecord, WatchlistItem, ExchangeRates, Currency, BulkUploadResult, AllocationTargets, NewAssetForm } from './index';
import type { AlertSettings, AlertResult, AlertDataGap } from './alertRules';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { RiskMatrixRow } from '../utils/riskMatrix';
import type { BackupInfo, BackupSettings } from './backup';
import type { CategoryStore, CategoryBaseType } from './category';
import type { KnowledgeBase, RuleStatusDescriptor } from './knowledge';
import type { GuruSignalMatch, GuruSignalChartTarget, GuruSignalTarget } from '../utils/guruSignalEngine';
import type { PopupDeliveryDiagnosis } from './alertDiagnostics';
import type { TurtleReviewSummary } from '../utils/turtleReview';
import type { MarketOverviewSnapshot, MarketOverviewStatus } from './marketOverview';
import type { ColumnConfig, ColumnKey, FixedColumnWidths, EnrichedAsset, SignalDisplaySettings } from './ui';
import type { MALineConfig } from '../utils/maCalculations';
import type { ActionItem } from './actionQueue';
import type { TurtlePosition, TurtleSettings } from './turtle';
import type { ValuationSettings } from './valuation';
import type { OwnerFilter } from './owner';
import type { AddAssetResult, SellResult, BuyMoreResult } from './assetActionResult';
import type { CleanupDecision } from './cleanup';
import type { PortfolioSavePatch } from './portfolioSave';
import type { TradePlan, PlanDecision, PlanFill, PyramidFillResult, SellOutcome } from './tradePlan';
import type { TradePlanSignalRow } from '../hooks/useTradePlanSignals';
import type { TradePlanSignalSummary } from '../utils/tradePlanMarket';

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
  /** 수익률 기준(달러/원화) — 표·대시보드·알림이 모두 이 값을 따른다 */
  valuationSettings: ValuationSettings;
}

/**
 * **`PortfolioSavePatch`의 별칭**(5-A). 예전에는 5개 도메인만 담는 별도 인터페이스였으나,
 * 저장 경로가 하나로 합쳐지면서 13개 도메인 전부를 patch 로 넘길 수 있게 됐다.
 * 새 코드는 `types/portfolioSave`의 이름을 쓰고, 이 별칭은 기존 호출부 호환용으로만 유지한다.
 */
export type PortfolioPatch = PortfolioSavePatch;

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
  /** 'dashboard'가 기본 탭(라벨 '홈', 2026-09-14 사용자가 P3의 'today' 기본 탭 결정을 번복).
   *  'today'·'execution'은 폐지된 탭이지만 **별칭 입력값**으로 union에 남긴다 — 발송된 카톡의
   *  `?tab=today` 링크·옛 세션이 이 값을 넘길 수 있고, `actions.setActiveTab`이 `resolveTabAlias`
   *  (utils/deepLink)로 'dashboard'로 바꿔 상태에는 저장되지 않는다. 제거 금지. */
  activeTab: 'today' | 'dashboard' | 'portfolio' | 'analytics' | 'watchlist' | 'replay' | 'execution' | 'cleanup' | 'guide' | 'settings';
  globalPeriod: GlobalPeriod;
  /** 계정 뷰 필터 (통합/원종/유선) — 대시보드·포트폴리오 **표시 계층 전용**. 원본 data.assets는 절대 거르지 않음(저장 유실 방지). 매도통계·히스토리는 통합 기준 유지(1차 한계) */
  accountView: OwnerFilter;
  /** 대시보드 자산구분 필터. 숫자=코어 버킷의 해당 카테고리만, 'SATELLITE'=투더문 버킷 전체 (카테고리는 코어의 배분 축·투더문은 덩어리 취급) */
  dashboardFilterCategory: number | 'ALL' | 'SATELLITE';
  /** 포트폴리오 탭 자산구분 필터. 숫자=해당 카테고리(버킷 무관), 'SATELLITE'=투더문 버킷 전체 */
  filterCategory: number | 'ALL' | 'SATELLITE';
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
  /** P6 정보 다이어트 — 사용자가 [브리핑 다시 보기]를 명시적으로 눌렀는지(`actions.showBriefingPopup`이
   *  true로, `actions.dismissAlertPopup`이 false로 되돌림). 홈('dashboard') 탭에서 팝업이 자동으로 뜨지
   *  않게 막는 조건에만 쓰인다 — `derived.showAlertPopup`(useAutoAlert 게이트)은 이 값과 무관 */
  briefingManual: boolean;
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
  /** 매매 계획 일괄 만들기 마법사(TradePlanBulkWizard) 열림 여부 (P2a) */
  tradePlanBulkOpen: boolean;
  /**
   * 매도 모달 프리필 (P2b) — 계획 카드의 [매도 기록]으로 열었을 때만 채워진다.
   * `sellingAsset`과 **함께** 세팅/해제되므로 모달이 열려 있는 동안 단독으로 바뀌지 않는다
   * (그래서 리셋 effect의 의존성에 직접 넣어도 배경 시세 갱신에 재발화하지 않는다).
   */
  sellPrefill: { quantity?: number; price?: number; outcome?: SellOutcome } | null;
  /** "새 매수 계획" 독립 화면(TradePlanPlanner) 열림 여부 (P2c) */
  plannerOpen: boolean;
  /** 플래너 진입 프리필 — 관심종목 행 메뉴 등에서 특정 종목으로 바로 시작할 때 채운다. 없으면 빈 검색부터 */
  plannerPrefill: { watchItemId?: string; ticker?: string; exchange?: string; name?: string } | null;
  /**
   * 신규 자산 추가 모달 프리필 (P2c) — 플래너의 [지금 매수 기록하며 저장]에서 넘어온 값.
   * `plan`이 있으면 P2a "이 계획으로 저장" 기본 템플릿 대신 이 계획을(체결값으로 재구축해) 사용한다.
   */
  addAssetPrefill: {
    ticker: string;
    exchange: string;
    name: string;
    currency?: Currency;
    categoryId?: number;
    quantity?: number;
    purchasePrice?: number;
    plan?: TradePlan;
  } | null;
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
  /** 정리 가능한 완료 주문 요약 (Phase 5) — done/skipped 중 90일 경과분. 표시/버튼 게이팅용(저장 없음) */
  compactableActions: { count: number; cutoffDate: string };
  showAlertPopup: boolean;
  // 백업
  backupList: BackupInfo[];
  backupSettings: BackupSettings;
  isBackingUp: boolean;
  // 시장 요약(금 김치 프리미엄 + 환율) — 원시 스냅샷. 프리미엄은 UI에서 유효환율로 파생.
  marketOverview: MarketOverviewSnapshot | null;
  marketOverviewStatus: MarketOverviewStatus;
  marketOverviewError: string | null;
  /** 마지막 시세 갱신 완료 시각(ISO) — localStorage 'asset-manager-last-price-refresh-at' 미러(P4) */
  priceDataAsOf: string | null;
  /** priceDataAsOf 한국어 표시 라벨 — `utils/priceFreshness.describeFreshness` 결과 (예: '09-03 14:20 (장중)') */
  priceFreshnessLabel: string;
  /** 활성 매매 계획 평가 행 (P2a) — `hooks/useTradePlanSignals`. 긴급→오늘 실행→준비→대기 정렬 완료 */
  tradePlanRows: TradePlanSignalRow[];
  /** 매매 계획 등급별 건수 + 확인 필요(시세결측/오래됨/손절주문 미등록) — 홈 '오늘의 브리핑' 배지·요약용 */
  tradePlanSummary: TradePlanSignalSummary;
  /** 일괄 계획 마법사 대상(투더문 보유 中 계획 없음) — `utils/tradePlan.isEligibleForBulkPlan` */
  planlessSatellites: Asset[];
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
  addAsset: (asset: NewAssetForm & { name?: string }) => Promise<AddAssetResult>;
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
  /** 완료 주문 정리 (Phase 5) — done/skipped 중 90일 경과분을 메인 payload에서 제거 후 원자 커밋. 제거 건수 반환(0이면 미저장) */
  compactActionQueue: () => number;
  updateTurtlePositions: (positions: TurtlePosition[]) => void;
  updateTurtleSettings: (settings: TurtleSettings) => void;
  /** 수익률 기준 전환 (표시 설정) — 상태 갱신 + Drive 자동 저장. 표·대시보드·알림 판정이 함께 바뀐다 */
  updateValuationSettings: (settings: ValuationSettings) => void;
  /** 교차도메인 원자 커밋 — 지정 도메인 set + 단일 autosave (터틀 실행의 저장 경합 방지) */
  commitPortfolioPatch: (patch: PortfolioPatch) => void;
  /** 대청소 일괄 분류 저장 (Phase 3b) — assetId별 결정을 자산에 적용 후 단일 커밋. 결정 없는 자산 불변 */
  saveCleanupDecisions: (decisions: Record<string, CleanupDecision>) => void;

  // 시장 요약(금 김치 프리미엄 + 환율)
  refreshMarketOverview: () => Promise<void>;

  // 백업
  performBackup: () => Promise<void>;
  loadBackupList: () => Promise<void>;
  restoreBackup: (fileId: string) => Promise<void>;
  deleteBackup: (fileId: string) => Promise<void>;
  updateBackupSettings: (settings: BackupSettings) => void;

  // 매매 계획 (P2a) — 전부 commitPortfolio(단일 커밋) 경유. now/date는 액션 내부에서 생성(utils는 순수 유지).
  /** 자산에 계획 저장(신규 생성/수정 공용) — status active로 덮어쓴다 */
  saveTradePlan: (assetId: string, plan: TradePlan) => void;
  /** 계획 해제 — cancelPlan(status closed reason manual)로 기록은 보존, 삭제 아님 */
  clearTradePlan: (assetId: string) => void;
  /** 관심종목 계획 저장/제거. plan=null이면 tradePlan 필드 자체를 제거(매수 전 계획 취소) */
  saveWatchTradePlan: (watchItemId: string, plan: TradePlan | null) => void;
  /** 사용자 결정(실행/건너뜀/내일) 기록 — recordDecision 경유 */
  recordTradePlanDecision: (assetId: string, decision: PlanDecision) => void;
  /** 추세선 적용 시작(재돌파 확인, [적용 시작] 버튼) */
  armTradePlanExitLine: (assetId: string, date: string) => void;
  /** 증권사 손절 예약주문 등록 여부 토글 */
  setTradePlanBrokerStop: (assetId: string, registered: boolean) => void;
  /** 일괄 계획 마법사(TradePlanBulkWizard) 열기/닫기 */
  openTradePlanBulk: () => void;
  closeTradePlanBulk: () => void;
  /** 일괄 계획 마법사 저장 — 여러 자산의 계획을 단일 commitPortfolio로 저장 */
  saveTradePlansBulk: (entries: { assetId: string; plan: TradePlan }[]) => void;

  // 매매 계획 ↔ 매도/추가매수 기록 연동 (P2b)
  /** [매도 기록] 버튼 경유 — sellingAsset + sellPrefill(quantity/price/outcome)을 함께 연다 */
  openSellWithPlan: (assetId: string, outcome: SellOutcome) => void;
  /** 매도 확정(confirmSell) 성공 + 자산 존속 시 커밋 — outcome에 따라 계획 상태 전이(half=applyHalfSell, stop/exit=closePlan, none=무변경) */
  applyTradePlanSellOutcome: (assetId: string, outcome: SellOutcome, fill: PlanFill) => void;
  /** 추가매수 확정(confirmBuyMore) 성공 후 불타기 체결로 기록 — 4중 사전검사 실패 시 ok:false(사유는 setError로 표면화), 매수 자체는 롤백하지 않음 */
  applyTradePlanPyramidFill: (assetId: string, fill: PlanFill) => PyramidFillResult;

  // "새 매수 계획" 독립 화면 (P2c)
  /** 플래너 열기 — prefill 있으면 그 종목/관심종목 계획으로 바로 시작(종목 검색 건너뜀) */
  openTradePlanPlanner: (prefill?: { watchItemId?: string; ticker?: string; exchange?: string; name?: string }) => void;
  closeTradePlanPlanner: () => void;
  /** 신규 자산 추가 모달을 프리필로 연다 — 플래너 [지금 매수 기록하며 저장] 경유 */
  openAddAssetWithPrefill: (prefill: {
    ticker: string; exchange: string; name: string; currency?: Currency;
    categoryId?: number; quantity?: number; purchasePrice?: number; plan?: TradePlan;
  }) => void;
  /** 새로 추가된 자산과 짝이 맞는 관심종목의 활성 계획을 자산으로 이전(단일 커밋, `utils/tradePlanTransfer`) — 매칭 없으면 무변경 */
  adoptWatchPlanForAsset: (assetId: string) => void;
  /** 관심종목 추가 + 계획 저장을 한 커밋으로 — 플래너 [관심종목에 계획과 함께 저장] */
  addWatchItemWithPlan: (
    item: Omit<WatchlistItem, 'id' | 'currentPrice' | 'priceOriginal' | 'currency' | 'previousClosePrice' | 'highestPrice'>,
    plan: TradePlan
  ) => void;
}

export interface PortfolioContextValue {
  data: PortfolioData;
  status: PortfolioStatus;
  ui: UIState;
  modal: ModalState;
  derived: DerivedState;
  actions: PortfolioActions;
}
