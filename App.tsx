import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Header from './components/Header';
import EditAssetModal from './components/EditAssetModal';
import SellAssetModal from './components/SellAssetModal';
import EditSellRecordModal from './components/EditSellRecordModal';
import BuyMoreAssetModal from './components/BuyMoreAssetModal';
import BulkUploadModal from './components/BulkUploadModal';
import AddNewAssetModal from './components/AddNewAssetModal';
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
import CleanupView from './components/cleanup/CleanupView';

type ActiveTab = 'today' | 'dashboard' | 'portfolio' | 'analytics' | 'watchlist' | 'replay' | 'execution' | 'cleanup' | 'guide' | 'settings';
/** 더보기 메뉴 진입 화면들 — 탭바 4버튼(홈/보유자산/관심종목/더보기)에 없는 목적지. '더보기' 버튼
 *  자체의 활성 강조 판정에 쓰인다(계획서 §4.3 D7 — 리플레이/실행큐 탭 숨김, 코드 보존).
 *  2026-09-14: 대시보드가 '홈' 탭으로 승격돼 이 목록에서 빠졌다. */
const MORE_MENU_TABS: ActiveTab[] = ['analytics', 'cleanup', 'guide', 'replay', 'settings'];

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

  

  

  

  


  const TabButton: React.FC<{tabId: ActiveTab; children: React.ReactNode; onClick: () => void}> = ({ tabId, children, onClick }) => {
    const isActive = ui.activeTab === tabId;
    const activeClasses = "border-primary text-primary";
    const inactiveClasses = "border-transparent text-gray-400 hover:text-white hover:border-gray-500";
    return (
        <button
          onClick={onClick}
          className={`py-3 sm:py-4 px-2 sm:px-1 text-center border-b-2 font-medium text-xs sm:text-sm whitespace-nowrap focus:outline-none transition-colors duration-300 ${isActive ? activeClasses : inactiveClasses}`}
        >
          {children}
        </button>
    );
  };

  return (
    <div className="h-screen bg-gray-900 font-sans flex flex-col overflow-hidden">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 flex flex-col flex-1 overflow-hidden">
        {/* Update Notification & Messages */}
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-xl space-y-3 pointer-events-none">
          {updateAvailable && (
            <div className="bg-blue-600 text-white px-4 py-3 rounded-lg shadow-lg flex justify-between items-center pointer-events-auto" role="alert">
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
                  className="ml-2 text-white/80 hover:text-white transition"
                  onClick={() => setUpdateAvailable(false)}
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          {status.error && (
            <div className="bg-danger/90 text-white px-4 py-3 rounded-lg shadow-lg flex justify-between items-center pointer-events-auto">
              <span className="block sm:inline">{status.error}</span>
              <button className="ml-4 text-white/80 hover:text-white transition" onClick={() => actions.clearError()}>✕</button>
            </div>
          )}
        </div>

        {status.isInitializing ? (
          <main className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <svg className="animate-spin h-8 w-8 text-blue-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
              <div className="flex-shrink-0 bg-amber-600/90 text-white px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-medium">세션이 만료되었습니다. <span className="hidden sm:inline">데이터는 유지되지만 </span>저장/불러오기가 중단됩니다.</span>
                <button
                  onClick={actions.signIn}
                  className="ml-4 bg-white text-amber-700 font-semibold px-4 py-1.5 rounded-md text-sm hover:bg-amber-50 transition flex-shrink-0"
                >
                  다시 로그인
                </button>
              </div>
            )}
            <div className="flex-shrink-0 border-b border-gray-700">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center min-w-0">
                  <h1 className="hidden lg:block text-sm font-bold text-white tracking-tight whitespace-nowrap mr-4 flex-shrink-0" title="KIM'S 퀀트자산관리 — 퀀트 투자를 위한 포트폴리오 대시보드">
                    KIM'S 퀀트
                  </h1>
                  {/* P6: 모바일(<md)에서는 BottomTabBar가 이 자리를 대신한다 — 탭 개수·목적지는 동일, 위치만 하단으로 이동 */}
                  <nav className="-mb-px hidden md:flex space-x-3 sm:space-x-6 overflow-x-auto scrollbar-hide" aria-label="Tabs">
                    <TabButton tabId="dashboard" onClick={() => actions.setActiveTab('dashboard')}>홈</TabButton>
                    <TabButton tabId="portfolio" onClick={() => actions.setActiveTab('portfolio')}>보유자산</TabButton>
                    <TabButton tabId="watchlist" onClick={() => actions.setActiveTab('watchlist')}>관심종목</TabButton>
                    <button
                      ref={moreMenuRef}
                      onClick={() => setShowMoreMenu(prev => !prev)}
                      className={`py-3 sm:py-4 px-2 sm:px-1 text-center border-b-2 font-medium text-xs sm:text-sm whitespace-nowrap focus:outline-none transition-colors duration-300 ${
                        MORE_MENU_TABS.includes(ui.activeTab)
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
                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                  {/* P6: 모바일 상단바는 업데이트(아이콘)·+추가·아바타만 남긴다 — 나머지는 더보기/홈 화면에서 이미 볼 수 있음 */}
                  <div className="hidden md:block">
                    <UpdateStatusIndicator isLoading={status.isLoading} successMessage={status.successMessage} />
                  </div>
                  <div className="hidden md:block">
                  {(() => {
                    // 브리핑 배지 — 신호(알림 발화) + 실행(큐 대기 + 오늘 생성 가능, 터틀 자동 검토)
                    const signalCount = derived.alertResults.reduce((s, r) => s + r.matchedAssets.length, 0);
                    const aqs = derived.actionQueueSummary;
                    const execCount = aqs.actionableCount;
                    if (signalCount === 0 && execCount === 0) return null;
                    const cap = (n: number) => (n > 99 ? '99+' : String(n));
                    return (
                      <button
                        onClick={actions.showBriefingPopup}
                        className="flex items-center gap-1 sm:gap-1.5 text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 sm:px-2.5 py-2 rounded-md transition-colors border border-amber-500/30 whitespace-nowrap flex-shrink-0"
                        title={`투자 브리핑 다시 보기 — 신호 ${signalCount}건 · 실행 ${execCount}건${aqs.escalatedCount > 0 ? ` (${aqs.escalatedCount}건 3일+ 미실행)` : ''}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                        {execCount > 0 ? (
                          <span>
                            {signalCount > 0 && <>{cap(signalCount)}<span className="hidden sm:inline">건</span><span className="text-amber-500/60"> · </span></>}
                            <span className={aqs.escalatedCount > 0 ? 'text-red-300 font-semibold' : 'font-semibold'}>실행 {cap(execCount)}{aqs.escalatedCount > 0 ? '⚠' : ''}</span>
                          </span>
                        ) : (
                          <span>{cap(signalCount)}<span className="hidden sm:inline">건</span></span>
                        )}
                      </button>
                    );
                  })()}
                  </div>
                  {/* P4: 시세 기준 시각 — 데스크탑은 텍스트 노출, 모바일은 title 툴팁(공간 제약). 모바일 헤더 축소(P6) 대상에서 제외 — 짧은 라벨은 계속 보인다 */}
                  <span
                    className="text-[11px] text-gray-500 whitespace-nowrap flex-shrink-0"
                    title={derived.priceFreshnessLabel}
                  >
                    <span className="hidden md:inline">{derived.priceFreshnessLabel}</span>
                    <span className="md:hidden">{shortFreshnessLabel(derived.priceFreshnessLabel)}</span>
                  </span>
                  <button
                    onClick={() => actions.refreshAllPrices(false)}
                    disabled={status.isLoading}
                    className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 px-2 sm:px-2.5 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
                    title={`시세 업데이트 — ${derived.priceFreshnessLabel}`}
                  >
                    {status.isLoading ? (
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 4l1.5 1.5A9 9 0 0120.5 10M20 20l-1.5-1.5A9 9 0 003.5 14" />
                      </svg>
                    )}
                    <span className="hidden sm:inline">{status.isLoading ? '중...' : '업데이트'}</span>
                  </button>
                  {/* 계정 뷰 세그먼트 (통합/원종/유선) — 표시 필터 전용, 보유자산 탭에서만(홈은 본문 상단에 자체 세그먼트를 렌더). 모바일 상단바 축소(P6) 대상 */}
                  {ui.activeTab === 'portfolio' && (
                    <div className="hidden md:flex items-center bg-gray-700 rounded-md p-0.5 flex-shrink-0" role="group" aria-label="계정 뷰">
                      {OWNER_FILTER_OPTIONS.map(f => (
                        <button
                          key={f}
                          onClick={() => actions.setAccountView(f)}
                          className={`text-xs px-2 sm:px-2.5 py-1.5 rounded transition-colors whitespace-nowrap ${
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
                  {/* 홈(dashboard)은 기간 선택을 '손익 추이' 카드 안에 두므로 제외 */}
                  {ui.activeTab !== 'dashboard' && ui.activeTab !== 'today' && ui.activeTab !== 'guide' && ui.activeTab !== 'settings' && ui.activeTab !== 'analytics' && ui.activeTab !== 'replay' && ui.activeTab !== 'execution' && ui.activeTab !== 'cleanup' && (
                    <div className="hidden md:block">
                      <PeriodSelector value={ui.globalPeriod} onChange={actions.setGlobalPeriod} variant="dropdown" />
                    </div>
                  )}
                  <button
                    onClick={actions.openAddAsset}
                    className="bg-primary hover:bg-primary-dark text-white font-semibold text-xs py-2 px-2.5 sm:px-3 rounded-md transition-colors whitespace-nowrap flex-shrink-0"
                    title="새로운 자산을 포트폴리오에 추가합니다."
                  >
                    <span className="sm:hidden">+ 추가</span>
                    <span className="hidden sm:inline">+ 자산 추가</span>
                  </button>
                  <div className="flex items-center gap-1.5 border-l border-gray-700 pl-2 ml-1 flex-shrink-0">
                    <button
                      ref={accountMenuRef}
                      onClick={() => setShowAccountMenu(prev => !prev)}
                      className="w-8 h-8 rounded-full bg-primary/20 text-primary text-sm font-bold flex items-center justify-center hover:bg-primary/30 transition-colors"
                      title={status.userEmail ? `계정 및 데이터 관리: ${status.userEmail}` : '계정 및 데이터 관리'}
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
                          { label: '로그아웃', onClick: actions.signOut, colorClass: 'text-red-400' },
                        ]}
                        onClose={() => setShowAccountMenu(false)}
                      />
                    )}
                    {/* P6: 모바일에선 더보기 메뉴의 "설정" 항목과 중복되므로 숨긴다 */}
                    <button
                      onClick={() => actions.setActiveTab('settings')}
                      className={`hidden md:flex items-center p-2 sm:p-1.5 rounded-md transition-colors ${
                        ui.activeTab === 'settings'
                          ? 'text-primary bg-primary/10'
                          : 'text-gray-400 hover:text-white hover:bg-gray-700'
                      }`}
                      title="설정"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
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
                {ui.activeTab === 'cleanup' && <CleanupView />}
                {ui.activeTab === 'guide' && <InvestmentGuideView />}
                {ui.activeTab === 'settings' && <SettingsPage />}
              </div>
            </main>

            {/* P6: 모바일 하단 탭바 — md 미만에서만(컴포넌트 내부에서 md:hidden) */}
            <BottomTabBar
              activeTab={ui.activeTab}
              onTabChange={actions.setActiveTab}
              moreActive={MORE_MENU_TABS.includes(ui.activeTab)}
              moreMenuItems={moreMenuItems}
            />

            {showScrollTop && (
              <button
                onClick={() => mainRef.current?.scrollTo({ top: 0 })}
                className={`fixed right-4 sm:right-8 mb-[env(safe-area-inset-bottom)] bg-gray-700 hover:bg-gray-600 text-white rounded-full p-3 shadow-lg transition-all z-[70] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-primary ${
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
