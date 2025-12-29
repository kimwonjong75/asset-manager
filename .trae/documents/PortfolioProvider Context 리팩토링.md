## 타입 설계 원칙
- any 금지: 모든 필드·액션 파라미터·반환값은 구체 타입 지정
- 기존 도메인 타입 재사용: Asset/ExchangeRates/WatchlistItem/PortfolioSnapshot 등 [types.ts](file:///c:/Users/beari/Desktop/Dev/asset-manager/types.ts) 활용
- 컨텍스트 타입과 구현 분리: 컨텍스트는 도메인 타입에만 의존, 훅 구현 시그니처에 직접 의존하지 않음
- 파생값은 읽기 전용(readonly) 및 메모이제이션 고려

## 컨텍스트 인터페이스 구성
- PortfolioData
  - assets: Asset[]
  - portfolioHistory: PortfolioSnapshot[] (별칭: PortfolioHistory)
  - sellHistory: SellRecord[] ([types.ts:L147-L153](file:///c:/Users/beari/Desktop/Dev/asset-manager/types.ts#L147-L153))
  - watchlist: WatchlistItem[] ([types.ts:L111-L129](file:///c:/Users/beari/Desktop/Dev/asset-manager/types.ts#L111-L129))
  - exchangeRates: ExchangeRates ([types.ts:L27-L30](file:///c:/Users/beari/Desktop/Dev/asset-manager/types.ts#L27-L30))
- PortfolioStatus
  - isLoading: boolean
  - failedAssetIds: string[]
  - isSignedIn: boolean
  - userEmail: string | null
  - isInitializing: boolean
  - error: string | null
  - successMessage: string | null
  - showExchangeRateWarning: boolean
- UIState
  - activeTab: 'dashboard' | 'portfolio' | 'analytics' | 'watchlist'
  - dashboardFilterCategory: Asset['category'] | 'ALL'
  - filterCategory: Asset['category'] | 'ALL'
  - filterAlerts: boolean
  - searchQuery: string
  - sellAlertDropRate: number
- ModalState
  - editingAsset: Asset | null
  - sellingAsset: Asset | null
  - bulkUploadOpen: boolean
  - addAssetOpen: boolean
  - assistantOpen: boolean
- DerivedState
  - totalValue: number
  - alertCount: number
- PortfolioActions
  - 저장/불러오기/내보내기
    - saveToDrive: () => Promise<void>
    - exportJson: () => void
    - importJson: (file: File) => Promise<void>
    - exportCsv: () => void
  - 인증
    - signIn: () => Promise<void>
    - signOut: () => Promise<void>
  - 환율/시세
    - setExchangeRates: (rates: ExchangeRates) => void
    - refreshAllPrices: () => Promise<void>
    - refreshSelectedPrices: (ids: string[]) => Promise<void>
    - refreshOnePrice: (id: string) => Promise<void>
  - 자산
    - addAsset: (asset: Asset) => Promise<void>
    - updateAsset: (asset: Asset) => Promise<void>
    - deleteAsset: (id: string) => Promise<void>
    - confirmSell: (id: string, tx: SellTransaction) => Promise<void> ([types.ts:L132-L145](file:///c:/Users/beari/Desktop/Dev/asset-manager/types.ts#L132-L145))
  - 관심종목
    - addWatchItem: (item: WatchlistItem) => Promise<void>
    - updateWatchItem: (item: WatchlistItem) => Promise<void>
    - deleteWatchItem: (id: string) => Promise<void>
    - toggleWatchMonitoring: (id: string, enabled: boolean) => Promise<void>
    - refreshWatchlistPrices: () => Promise<void>
    - bulkDeleteWatchItems: (ids: string[]) => Promise<void>
  - UI/모달
    - setActiveTab: (tab: UIState['activeTab']) => void
    - setDashboardFilterCategory: (c: UIState['dashboardFilterCategory']) => void
    - setFilterCategory: (c: UIState['filterCategory']) => void
    - setFilterAlerts: (v: boolean) => void
    - setSearchQuery: (q: string) => void
    - setSellAlertDropRate: (n: number) => void
    - openEditModal: (asset: Asset) => void
    - closeEditModal: () => void
    - openSellModal: (asset: Asset) => void
    - closeSellModal: () => void
    - openBulkUpload: () => void
    - closeBulkUpload: () => void
    - openAddAsset: () => void
    - closeAddAsset: () => void
    - openAssistant: () => void
    - closeAssistant: () => void
- PortfolioContextValue
  - data: PortfolioData
  - status: PortfolioStatus
  - ui: UIState
  - modal: ModalState
  - derived: DerivedState
  - actions: PortfolioActions

## 주석/문서화 전략
- JSDoc 사용: 각 인터페이스·필드·액션에 @description, 파라미터/반환 설명 추가
- 섹션 주석: Data/Status/UI/Modal/Derived/Actions 블록별 헤더 주석으로 책임 범위 명시
- 도메인 레퍼런스 링크: 주요 타입 출처(types.ts 라인)와 사용 컴포넌트 링크 삽입
- 이후 분리 용이성: 타입은 상단, 구현은 하단에 배치하고 export를 명확히 구분

## 의존성/순환 회피
- 컨텍스트 타입은 types.ts의 도메인 타입만 import, 훅 함수 타입에 직접 의존하지 않음
- Provider는 훅(usePortfolioData/useMarketData/useAssetActions)을 내부에서 사용해 actions를 바인딩

## 구현 단계(요약)
1) contexts/PortfolioContext.tsx 생성: 위 인터페이스와 JSDoc 주석 정의 후 Provider 구현
2) usePortfolio() 도우미 훅 추가
3) App.tsx 트리 전체를 u007fPortfolioProvideru007f로 래핑, 하위 컴포넌트에서 props 제거하고 usePortfolio()로 전환
   - 사례: [Header](file:///c:/Users/beari/Desktop/Dev/asset-manager/App.tsx#L426-L437), [DashboardView](file:///c:/Users/beari/Desktop/Dev/asset-manager/App.tsx#L490-L505), [PortfolioView](file:///c:/Users/beari/Desktop/Dev/asset-manager/App.tsx#L507-L529), [AnalyticsView](file:///c:/Users/beari/Desktop/Dev/asset-manager/App.tsx#L531-L533), [WatchlistView](file:///c:/Users/beari/Desktop/Dev/asset-manager/App.tsx#L535-L545), 모달들 [L549-L591](file:///c:/Users/beari/Desktop/Dev/asset-manager/App.tsx#L549-L591)

## 검증
- 타입체크: any 금지 여부와 JSDoc 유효성 확인
- 통합 테스트: 시세 갱신/자산 CRUD/관심종목/모달/저장/가져오기 동작
- UI 회귀: 필터/검색/경고/합계 및