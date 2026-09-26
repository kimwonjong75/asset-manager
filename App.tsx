import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Header from './components/Header';
import EditAssetModal from './components/EditAssetModal';
import SellAssetModal from './components/SellAssetModal';
import EditSellRecordModal from './components/EditSellRecordModal';
import BuyMoreAssetModal from './components/BuyMoreAssetModal';
import BulkUploadModal from './components/BulkUploadModal';
import AddNewAssetModal from './components/AddNewAssetModal';
import TurtleHoldingsBuyModal from './components/execution/TurtleHoldingsBuyModal';
import TradePlanBulkWizard from './components/trade-plan/TradePlanBulkWizard';
import TradePlanPlanner from './components/trade-plan/TradePlanPlanner';
import PortfolioAssistant from './components/PortfolioAssistant';
import PeriodSelector from './components/common/PeriodSelector';
import ActionMenu, { type ActionMenuItem } from './components/common/ActionMenu';
import AlertPopup from './components/common/AlertPopup';
import UpdateStatusIndicator from './components/common/UpdateStatusIndicator';
import BottomTabBar from './components/common/BottomTabBar';
import SettingsPage from './components/SettingsPage';

// Hooks
import { PortfolioProvider, usePortfolio } from './contexts/PortfolioContext';
import { useSymbolListPrefetch } from './hooks/useSymbolListPrefetch';
import { OWNER_FILTER_OPTIONS, OWNER_FILTER_LABELS } from './types/owner';
import { parseDeepLink } from './utils/deepLink';

// Layouts
import DashboardView from './components/layouts/DashboardView';
import PortfolioView from './components/layouts/PortfolioView';
import AnalyticsView from './components/layouts/AnalyticsView';
import WatchlistView from './components/layouts/WatchlistView';
import InvestmentGuideView from './components/layouts/InvestmentGuideView';
import SignalReplayView from './components/layouts/SignalReplayView';
// 옛 '대청소' 코드는 보존한다(components/cleanup/CleanupView.tsx, 삭제하지 않음) — 계획서 §6 P2로
// 'cleanup' 탭이 아래 TurtleCleanupView로 교체됐다. 되돌리려면 import를 CleanupView로 바꾸고 아래
// 렌더의 컴포넌트명만 바꾸면 된다.
import TurtleCleanupView from './components/cleanup/TurtleCleanupView';

// Stage B: 탭별 앱바 구성(화면 제목·계정뷰 세그먼트·기간 선택·더보기 강조)은 constants/tabMeta의
// TAB_META 한 곳에서 선언한다 — 여기서 `ui.activeTab !== …` 연쇄 조건을 다시 만들지 말 것.
import { getTabMeta, type AppTab } from './constants/tabMeta';
import { Bell, X } from 'lucide-react';

// P4: 모바일 상단바는 공간이 좁아 `derived.priceFreshnessLabel`(예: '09-03 14:20 (장중)'/'09-02 마감 후')을
// 전부 못 보여준다 — 시:분만 남기고, 없으면(마감 후·기준시각 없음) 원문을 짧게 자른다. 순수 표시 포맷팅.
function shortFreshnessLabel(label: string): string {
  const timeMatch = label.match(/(\d{2}:\d{2})/);
  if (timeMatch) return timeMatch[1];
  return label.length > 5 ? label.slice(0, 5) : label;
}

const AppContent: React.FC = () => {
  const { data, status, ui, modal, actions, derived } = usePortfolio();

  // 로그인 + 초기 시세 로딩 후 종목 목록(1.3MB)을 백그라운드로 미리 받아 첫 종목검색 대기를 없앤다.
  useSymbolListPrefetch(status.isSignedIn, status.isLoading);

  // P3: AlertPopup "계획 기준 우선" 배지용 — 활성 매매 계획이 있는 자산 id 집합(표시 전용, 계산 불변).
  const planPriorityAssetIds = useMemo(
    () => new Set(data.assets.filter(a => a.tradePlan?.status === 'active').map(a => a.id)),
    [data.assets]
  );

  // P6: '더보기' 메뉴 항목 — 데스크탑 드롭다운과 모바일 하단 탭바(BottomTabBar)가 **같은 배열**을
  // 공유한다(둘 다 ActionMenu를 쓰므로 하나만 정의하면 됨). 어시스턴트 FAB을 없애면서 여기로 이동.
  const moreMenuItems: ActionMenuItem[] = useMemo(() => [
    { label: '수익 통계', onClick: () => actions.setActiveTab('analytics') },
    { label: '매매 계획 세우기', onClick: () => actions.openTradePlanPlanner() },
    { label: '대청소', onClick: () => actions.setActiveTab('cleanup') },
    { label: 'AI 어시스턴트', onClick: () => actions.openAssistant() },
    { label: '투자 가이드', onClick: () => actions.setActiveTab('guide') },
    { label: '연구실 · 신호 리플레이', onClick: () => actions.setActiveTab('replay') },
    { label: '설정', onClick: () => actions.setActiveTab('settings') },
  ], [actions]);

  // P4: 딥링크 — 로그인 완료 후 1회, `?tab=…&asset=…`을 해석해 탭 이동 + 종목 포커스.
  // asset 참조가 있는데 아직 포트폴리오/관심종목이 비어 있고 로딩 중이면(Drive 로드 전) 다음
  // 렌더까지 기다린다 — 로딩이 끝나면(빈 포트폴리오여도) 더 기다리지 않고 처리한다.
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current || !status.isSignedIn) return;
    const target = parseDeepLink(window.location.search);
    if (!target) { deepLinkHandledRef.current = true; return; }
    if (target.assetRef && data.assets.length === 0 && data.watchlist.length === 0 && status.isLoading) return;
    deepLinkHandledRef.current = true;

    actions.setActiveTab(target.tab);
    if (target.assetRef) {
      const ref = target.assetRef;
      if (ref.kind === 'id') {
        if (data.watchlist.some(w => w.id === ref.id)) actions.setFocusedWatchItemId(ref.id);
        else actions.setFocusedAssetId(ref.id);
      } else {
        const asset = data.assets.find(a => a.ticker === ref.ticker && a.exchange === ref.exchange);
        if (asset) {
          actions.setFocusedAssetId(asset.id);
        } else {
          const watchItem = data.watchlist.find(w => w.ticker === ref.ticker && w.exchange === ref.exchange);
          if (watchItem) actions.setFocusedWatchItemId(watchItem.id);
        }
      }
    }

    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url.toString());
  }, [status.isSignedIn, status.isLoading, data.assets, data.watchlist, actions]);

  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [fileName, setFileName] = useState<string>('portfolio.json');
  const mainRef = useRef<HTMLElement | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const accountMenuRef = useRef<HTMLButtonElement>(null);
  // P3: '더보기' 탭바 버튼 — 숨긴 탭(수익통계/대청소/가이드/연구실/설정) 진입점.
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLButtonElement>(null);

  const mainCallbackRef = useCallback((node: HTMLElement | null) => {
    if (mainRef.current) {
      mainRef.current.removeEventListener('scroll', handleMainScroll);
    }
    mainRef.current = node;
    if (node) {
      node.addEventListener('scroll', handleMainScroll, { passive: true });
    }
  }, []);

  function handleMainScroll(this: HTMLElement) {
    setShowScrollTop(this.scrollTop > 300);
  }




  // 버전 체크 로직
  useEffect(() => {
    const checkForUpdate = async () => {
      try {
        const res = await fetch('metadata.json', { cache: 'no-store' });
        if (!res.ok) return;
        const lm = res.headers.get('last-modified');
        if (lm) {
          const prev = localStorage.getItem('app.lastModified');
          if (prev && prev !== lm) {
            setUpdateAvailable(true);
          }
          localStorage.setItem('app.lastModified', lm);
        }
      } catch {}
    };
    checkForUpdate();
  }, []);

  

  

  

  


  const TabButton: React.FC<{tabId: AppTab; children: React.ReactNode; onClick: () => void}> = ({ tabId, children, onClick }) => {
    const isActive = ui.activeTab === tabId;
    const activeClasses = "border-primary text-primary";
    const inactiveClasses = "border-transparent text-gray-400 hover:text-white hover:border-gray-500";
    return (
        <button
          type="button"
          onClick={onClick}
          aria-current={isActive ? 'page' : undefined}
          className={`py-3 sm:py-4 px-2 sm:px-1 text-center border-b-2 font-medium text-xs sm:text-sm whitespace-nowrap focus-ring transition-colors duration-300 ${isActive ? activeClasses : inactiveClasses}`}
        >
          {children}
        </button>
    );
  };

  // Stage B: 현재 탭의 앱바 선언값 + 브리핑 벨 배지(신호 발화 종목 수 + 실행 가능 건수)
  const tabMeta = getTabMeta(ui.activeTab);
  const briefingSignalCount = derived.alertResults.reduce((s, r) => s + r.matchedAssets.length, 0);
  const briefingExec = derived.actionQueueSummary;
  const briefingCount = briefingSignalCount + briefingExec.actionableCount;
  const briefingBadge = briefingCount > 99 ? '99+' : String(briefingCount);

  return (
    <div className="h-screen h-dvh bg-gray-900 font-sans flex flex-col overflow-hidden">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 flex flex-col flex-1 overflow-hidden">
        {/* Update Notification & Messages — z-banner: 모달 작업 중 난 오류도 모달 위에 보이게 */}
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-banner w-[90%] max-w-xl space-y-3 pointer-events-none">
          {updateAvailable && (
            <div className="bg-info-strong text-white px-4 py-3 rounded-lg shadow-lg flex justify-between items-center pointer-events-auto" role="alert">
              <span className="block sm:inline">새 버전이 배포되었습니다.</span>
              <div className="flex items-center gap-2">
                <button
                  className="ml-2 bg-white/20 hover:bg-white/30 text-white px-3 py-1 rounded transition"
                  onClick={() => {
                    const baseUrl = window.location.href.split('?')[0];
                    window.location.replace(`${baseUrl}?_ts=${Date.now()}`);
                  }}
                >
                  업데이트 적용
                </button>
                <button
                  className="ml-2 inline-flex items-center justify-center min-h-9 min-w-9 rounded-md text-white/80 hover:text-white transition"
                  onClick={() => setUpdateAvailable(false)}
                  aria-label="새 버전 알림 닫기"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
          {status.error && (
            <div className="bg-danger-strong text-white px-4 py-3 rounded-lg shadow-lg flex justify-between items-center pointer-events-auto">
              <span className="block sm:inline">{status.error}</span>
              <button className="ml-4 inline-flex items-center justify-center min-h-9 min-w-9 rounded-md text-white/80 hover:text-white transition" onClick={() => actions.clearError()} aria-label="오류 메시지 닫기"><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          )}
        </div>

        {status.isInitializing ? (
          <main className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <svg className="animate-spin h-8 w-8 text-info mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-gray-400 text-sm">로그인 확인 중...</p>
            </div>
          </main>
        ) : status.isSignedIn ? (
          <>
            {/* 세션 만료 재로그인 배너 */}
            {status.needsReAuth && (
              <div className="flex-shrink-0 bg-warning-strong text-white px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-medium">세션이 만료되었습니다. <span className="hidden sm:inline">데이터는 유지되지만 </span>저장/불러오기가 중단됩니다.</span>
                <button
                  onClick={actions.signIn}
                  className="ml-4 bg-white text-warning-strong font-semibold px-4 py-1.5 rounded-md text-sm hover:bg-gray-100 transition flex-shrink-0"
                >
                  다시 로그인
                </button>
              </div>
            )}
            <div className="flex-shrink-0 border-b border-gray-700">
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <div className="flex items-center min-w-0">
                  <h1 className="hidden lg:block text-sm font-bold text-white tracking-tight whitespace-nowrap mr-4 flex-shrink-0" title="KIM'S 퀀트자산관리 — 퀀트 투자를 위한 포트폴리오 대시보드">
                    KIM'S 퀀트
                  </h1>
                  {/* Stage B: 모바일(<md) 상단바 좌측 화면 제목 — TAB_META.mobileTitle (홈은 브랜드명) */}
                  {tabMeta.mobileTitle ? (
                    <h1 className="md:hidden text-base font-bold text-white truncate py-3">{tabMeta.title}</h1>
                  ) : (
                    <p className="md:hidden text-sm font-bold text-white tracking-tight whitespace-nowrap py-3">KIM'S 퀀트</p>
                  )}
                  {/* P6: 모바일(<md)에서는 BottomTabBar가 이 자리를 대신한다 — 탭 개수·목적지는 동일, 위치만 하단으로 이동 */}
                  <nav className="-mb-px hidden md:flex space-x-3 sm:space-x-6 overflow-x-auto scrollbar-hide" aria-label="Tabs">
                    <TabButton tabId="dashboard" onClick={() => actions.setActiveTab('dashboard')}>홈</TabButton>
                    <TabButton tabId="portfolio" onClick={() => actions.setActiveTab('portfolio')}>보유자산</TabButton>
                    <TabButton tabId="watchlist" onClick={() => actions.setActiveTab('watchlist')}>관심종목</TabButton>
                    <button
                      ref={moreMenuRef}
                      type="button"
                      onClick={() => setShowMoreMenu(prev => !prev)}
                      aria-haspopup="menu"
                      aria-expanded={showMoreMenu}
                      className={`py-3 sm:py-4 px-2 sm:px-1 text-center border-b-2 font-medium text-xs sm:text-sm whitespace-nowrap focus-ring transition-colors duration-300 ${
                        tabMeta.inMoreMenu
                          ? 'border-primary text-primary'
                          : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
                      }`}
                    >
                      더보기
                    </button>
                    {showMoreMenu && (
                      <ActionMenu
                        anchorRef={moreMenuRef}
                        items={moreMenuItems}
                        onClose={() => setShowMoreMenu(false)}
                      />
                    )}
                  </nav>
                </div>
                {/* Stage B: 상태 표시 단일 마운트 — 모바일은 헤더 아래 한 줄(order-last w-full), md 이상은 우측 컨트롤 왼쪽 인라인.
                    표시할 메시지가 없으면 컴포넌트가 null → 빈 래퍼는 empty:hidden 으로 공간을 차지하지 않는다 */}
                <div className="order-last w-full pb-1.5 md:order-none md:w-auto md:pb-0 md:ml-auto empty:hidden" aria-live="polite">
                  <UpdateStatusIndicator isLoading={status.isLoading} successMessage={status.successMessage} />
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 py-1.5 md:py-0">
                  {/* Stage B 앱바 = 탭별 선택 컨트롤(데스크탑) + 공통 4컨트롤 [갱신+기준시각] [+ 자산 추가] [🔔 브리핑] [아바타] */}
                  {/* 계정 뷰 세그먼트 (통합/원종/유선) — 표시 필터 전용, TAB_META.showAccountView(보유자산만). 데스크탑 전용 */}
                  {tabMeta.showAccountView && (
                    <div className="hidden md:flex items-center bg-gray-700 rounded-md p-0.5 flex-shrink-0" role="group" aria-label="계정 뷰">
                      {OWNER_FILTER_OPTIONS.map(f => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => actions.setAccountView(f)}
                          aria-pressed={ui.accountView === f}
                          className={`text-xs px-2 sm:px-2.5 py-1.5 rounded transition-colors whitespace-nowrap focus-ring ${
                            ui.accountView === f
                              ? 'bg-primary text-white font-semibold'
                              : 'text-gray-300 hover:text-white'
                          }`}
                          title={f === 'ALL' ? '모든 계정 자산 표시' : `${OWNER_FILTER_LABELS[f]} 계정 자산만 표시`}
                        >
                          {OWNER_FILTER_LABELS[f]}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* 기간 선택 — TAB_META.showPeriod(보유자산·관심종목). 데스크탑 전용 */}
                  {tabMeta.showPeriod && (
                    <div className="hidden md:block">
                      <PeriodSelector value={ui.globalPeriod} onChange={actions.setGlobalPeriod} variant="dropdown" />
                    </div>
                  )}
                  {/* ① 갱신 — 시세 기준시각을 버튼 안에 표시(모바일은 시:분만) */}
                  <button
                    type="button"
                    onClick={() => actions.refreshAllPrices(false)}
                    disabled={status.isLoading}
                    className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 px-2 sm:px-2.5 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0 focus-ring"
                    title={`시세 업데이트 — 기준 ${derived.priceFreshnessLabel}`}
                    aria-label={`시세 업데이트, 기준 ${derived.priceFreshnessLabel}`}
                  >
                    {status.isLoading ? (
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 4l1.5 1.5A9 9 0 0120.5 10M20 20l-1.5-1.5A9 9 0 003.5 14" />
                      </svg>
                    )}
                    <span className="hidden lg:inline">{status.isLoading ? '업데이트 중' : '업데이트'}</span>
                    <span className="hidden md:inline text-gray-400">{derived.priceFreshnessLabel}</span>
                    <span className="md:hidden text-gray-400">{shortFreshnessLabel(derived.priceFreshnessLabel)}</span>
                  </button>
                  {/* ② + 자산 추가 */}
                  <button
                    type="button"
                    onClick={actions.openAddAsset}
                    className="bg-primary hover:bg-primary-dark text-white font-semibold text-xs py-2 px-2.5 sm:px-3 rounded-md transition-colors whitespace-nowrap flex-shrink-0 focus-ring"
                    title="새로운 자산을 포트폴리오에 추가합니다."
                  >
                    <span className="sm:hidden">+ 추가</span>
                    <span className="hidden sm:inline">+ 자산 추가</span>
                  </button>
                  {/* ③ 브리핑 벨 — 모든 폭에서 표시. 배지 = 신호 발화 종목 + 실행 가능 건수(0이면 배지 숨김) */}
                  <button
                    type="button"
                    onClick={actions.showBriefingPopup}
                    className="relative p-2 rounded-md text-gray-300 hover:text-white hover:bg-gray-700 transition-colors flex-shrink-0 focus-ring"
                    aria-label={briefingCount > 0 ? `브리핑 열기, ${briefingCount}건` : '브리핑 열기'}
                    title={`알림 브리핑 — 신호 ${briefingSignalCount}건 · 실행 ${briefingExec.actionableCount}건${briefingExec.escalatedCount > 0 ? ` (${briefingExec.escalatedCount}건 3일+ 미실행)` : ''}`}
                  >
                    <Bell className="h-5 w-5" aria-hidden="true" />
                    {briefingCount > 0 && (
                      <span
                        className="absolute -top-0.5 -right-0.5 min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-warning text-gray-900 text-xs leading-[1.125rem] font-bold text-center tabular-nums"
                        aria-hidden="true"
                      >
                        {briefingBadge}
                      </span>
                    )}
                  </button>
                  {/* ④ 계정 아바타 — ⚙ 설정 버튼은 Stage B에서 제거(더보기 메뉴 '설정'으로 진입) */}
                  <div className="flex items-center border-l border-gray-700 pl-2 ml-1 flex-shrink-0">
                    <button
                      ref={accountMenuRef}
                      type="button"
                      onClick={() => setShowAccountMenu(prev => !prev)}
                      aria-haspopup="menu"
                      aria-expanded={showAccountMenu}
                      className="w-8 h-8 rounded-full bg-primary/20 text-primary text-sm font-bold flex items-center justify-center hover:bg-primary/30 transition-colors focus-ring"
                      title={status.userEmail ? `계정 및 데이터 관리: ${status.userEmail}` : '계정 및 데이터 관리'}
                      aria-label={status.userEmail ? `계정 메뉴: ${status.userEmail}` : '계정 메뉴'}
                    >
                      {(status.userEmail?.[0] ?? 'U').toUpperCase()}
                    </button>
                    {showAccountMenu && (
                      <ActionMenu
                        anchorRef={accountMenuRef}
                        header={status.userEmail ?? undefined}
                        items={[
                          { label: '즉시 저장 (Drive)', onClick: actions.saveToDrive },
                          { label: '일괄 등록 (CSV)', onClick: actions.openBulkUpload },
                          { label: '가져오기 (JSON)', onClick: actions.importJsonPrompt },
                          { label: '내보내기 (JSON)', onClick: () => actions.exportJson() },
                          { label: 'CSV로 내보내기', onClick: actions.exportCsv },
                          { label: '로그아웃', onClick: actions.signOut, colorClass: 'text-danger' },
                        ]}
                        onClose={() => setShowAccountMenu(false)}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            <main ref={mainCallbackRef} className="flex-1 overflow-y-auto min-h-0">
              {/* P6: 모바일은 하단 탭바(BottomTabBar, fixed)에 가려지지 않도록 바닥 여백 확보 */}
              <div className="pt-2 sm:pt-4 pb-20 md:pb-4">
                {/* 홈 = DashboardView('오늘의 브리핑' 포함). 'today'/'execution'은 setActiveTab의
                    resolveTabAlias가 'dashboard'로 바꿔 상태에 남지 않지만, 방어적으로 같은 화면을 그린다. */}
                {(ui.activeTab === 'dashboard' || ui.activeTab === 'today' || ui.activeTab === 'execution') && <DashboardView />}
                {ui.activeTab === 'portfolio' && <PortfolioView />}
                {ui.activeTab === 'analytics' && <AnalyticsView />}
                {ui.activeTab === 'watchlist' && <WatchlistView />}
                {ui.activeTab === 'replay' && <SignalReplayView />}
                {ui.activeTab === 'cleanup' && <TurtleCleanupView />}
                {ui.activeTab === 'guide' && <InvestmentGuideView />}
                {ui.activeTab === 'settings' && <SettingsPage />}
              </div>
            </main>

            {/* P6: 모바일 하단 탭바 — md 미만에서만(컴포넌트 내부에서 md:hidden) */}
            <BottomTabBar
              activeTab={ui.activeTab}
              onTabChange={actions.setActiveTab}
              moreActive={tabMeta.inMoreMenu}
              moreMenuItems={moreMenuItems}
            />

            {showScrollTop && (
              <button
                onClick={() => mainRef.current?.scrollTo({ top: 0 })}
                type="button"
                aria-label="맨 위로 이동"
                className={`hide-when-modal fixed right-4 sm:right-8 mb-[env(safe-area-inset-bottom)] bg-gray-700 hover:bg-gray-600 text-white rounded-full p-3 shadow-lg transition-all z-fab focus-ring ${
                  derived.showAlertPopup ? 'bottom-36 md:bottom-24' : 'bottom-20 md:bottom-8'
                }`}
                title="맨 위로 이동"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
            )}

            <EditAssetModal />
            <SellAssetModal />
            <EditSellRecordModal />
            <BuyMoreAssetModal />
            <BulkUploadModal />
            <AddNewAssetModal />
            <TradePlanBulkWizard />
            <TradePlanPlanner />
            <TurtleHoldingsBuyModal />

            {/* P6: 어시스턴트 FAB 제거 — 더보기 메뉴 "AI 어시스턴트" 항목으로 이동(모달 마운트는 유지) */}
            <PortfolioAssistant />

            {/* 투자 브리핑 팝업 — P6 정보 다이어트: 홈(dashboard) 탭에서는 자동으로 뜨지 않는다(홈 상단
                '오늘의 브리핑'이 이미 같은 내용을 보여줌). 사용자가 명시적으로 [브리핑 다시 보기]를 눌렀을 때만
                (`ui.briefingManual`) 홈에서도 뜬다 — 게이트 판정(derived.showAlertPopup)은 무변경 */}
            {derived.showAlertPopup && (ui.activeTab !== 'dashboard' || ui.briefingManual) && (
              <AlertPopup
                results={derived.alertResults}
                sellDataGaps={derived.sellDataGaps}
                executionSummary={derived.actionQueueSummary}
                planPriorityAssetIds={planPriorityAssetIds}
                onClose={actions.dismissAlertPopup}
                onAssetClick={(assetId, source) => {
                  if (source === 'watchlist') {
                    actions.setActiveTab('watchlist');
                    actions.setFocusedWatchItemId(assetId);
                  } else {
                    actions.setActiveTab('portfolio');
                    actions.setFocusedAssetId(assetId);
                  }
                }}
                onOpenExecution={() => {
                  // 실행 카드는 홈 상단 '오늘의 브리핑'에 있다 — 홈으로 이동 후 맨 위로 스크롤.
                  actions.setActiveTab('dashboard');
                  mainRef.current?.scrollTo({ top: 0 });
                  actions.dismissAlertPopup();
                }}
              />
            )}
          </>
        ) : (
          <main className="flex-1 overflow-y-auto min-h-0">
            <div className="pt-4 sm:pt-6">
              <Header onSignIn={actions.signIn} />
            </div>
            <div className="mt-12 bg-gray-800 border border-gray-700 rounded-lg p-8 text-center text-gray-200">
              <h2 className="text-2xl font-semibold mb-4">Google Drive 로그인 필요</h2>
              <p className="text-gray-400">
                포트폴리오 데이터는 Google Drive에만 저장됩니다. 상단의 로그인 버튼을 눌러 계정에 연결한 뒤 이용해주세요.
              </p>
            </div>
          </main>
        )}
      </div>

    </div>
  );
};

const App: React.FC = () => (
  <PortfolioProvider>
    <AppContent />
  </PortfolioProvider>
);

export default App;
