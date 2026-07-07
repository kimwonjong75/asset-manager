import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Header from './components/Header';
import EditAssetModal from './components/EditAssetModal';
import SellAssetModal from './components/SellAssetModal';
import EditSellRecordModal from './components/EditSellRecordModal';
import BuyMoreAssetModal from './components/BuyMoreAssetModal';
import BulkUploadModal from './components/BulkUploadModal';
import AddNewAssetModal from './components/AddNewAssetModal';
import PortfolioAssistant from './components/PortfolioAssistant';
import PeriodSelector from './components/common/PeriodSelector';
import ActionMenu from './components/common/ActionMenu';
import AlertPopup from './components/common/AlertPopup';
import UpdateStatusIndicator from './components/common/UpdateStatusIndicator';
import SettingsPage from './components/SettingsPage';

// Hooks
import { PortfolioProvider, usePortfolio } from './contexts/PortfolioContext';
import { OWNER_FILTER_OPTIONS, OWNER_FILTER_LABELS } from './types/owner';

// Layouts
import DashboardView from './components/layouts/DashboardView';
import PortfolioView from './components/layouts/PortfolioView';
import AnalyticsView from './components/layouts/AnalyticsView';
import WatchlistView from './components/layouts/WatchlistView';
import InvestmentGuideView from './components/layouts/InvestmentGuideView';
import SignalReplayView from './components/layouts/SignalReplayView';
import ExecutionView from './components/execution/ExecutionView';
import CleanupView from './components/cleanup/CleanupView';

type ActiveTab = 'dashboard' | 'portfolio' | 'analytics' | 'watchlist' | 'replay' | 'execution' | 'cleanup' | 'guide' | 'settings';

const AppContent: React.FC = () => {
  const { data, status, ui, modal, actions, derived } = usePortfolio();
  

  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [fileName, setFileName] = useState<string>('portfolio.json');
  const mainRef = useRef<HTMLElement | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const accountMenuRef = useRef<HTMLButtonElement>(null);

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
                  <nav className="-mb-px flex space-x-3 sm:space-x-6 overflow-x-auto scrollbar-hide" aria-label="Tabs">
                    <TabButton tabId="dashboard" onClick={() => actions.setActiveTab('dashboard')}>대시보드</TabButton>
                    <TabButton tabId="portfolio" onClick={() => actions.setActiveTab('portfolio')}>포트폴리오</TabButton>
                    <TabButton tabId="watchlist" onClick={() => actions.setActiveTab('watchlist')}>관심종목</TabButton>
                    <TabButton tabId="analytics" onClick={() => actions.setActiveTab('analytics')}><span className="sm:hidden">통계</span><span className="hidden sm:inline">수익 통계</span></TabButton>
                    <TabButton tabId="replay" onClick={() => actions.setActiveTab('replay')}><span className="sm:hidden">리플레이</span><span className="hidden sm:inline">신호 리플레이</span></TabButton>
                    <TabButton tabId="execution" onClick={() => actions.setActiveTab('execution')}><span className="sm:hidden">실행</span><span className="hidden sm:inline">실행 큐</span></TabButton>
                  </nav>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                  <UpdateStatusIndicator isLoading={status.isLoading} successMessage={status.successMessage} />
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
                  <button
                    onClick={() => {
                      if (window.confirm('전체 종목을 업데이트 하시겠습니까?')) {
                        actions.refreshAllPrices(false);
                      }
                    }}
                    disabled={status.isLoading}
                    className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 px-2 sm:px-2.5 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-shrink-0"
                    title="시세 업데이트"
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
                  {/* 계정 뷰 세그먼트 (통합/원종/유선) — 표시 필터 전용, 대시보드·포트폴리오 탭에서만 */}
                  {(ui.activeTab === 'dashboard' || ui.activeTab === 'portfolio') && (
                    <div className="flex items-center bg-gray-700 rounded-md p-0.5 flex-shrink-0" role="group" aria-label="계정 뷰">
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
                  {ui.activeTab !== 'guide' && ui.activeTab !== 'settings' && ui.activeTab !== 'analytics' && ui.activeTab !== 'replay' && ui.activeTab !== 'execution' && ui.activeTab !== 'cleanup' && (
                    <PeriodSelector value={ui.globalPeriod} onChange={actions.setGlobalPeriod} variant="dropdown" />
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
                          { label: '투자 가이드', onClick: () => actions.setActiveTab('guide') },
                          { label: '대청소', onClick: () => actions.setActiveTab('cleanup') },
                          { label: '로그아웃', onClick: actions.signOut, colorClass: 'text-red-400' },
                        ]}
                        onClose={() => setShowAccountMenu(false)}
                      />
                    )}
                    <button
                      onClick={() => actions.setActiveTab('settings')}
                      className={`flex items-center p-2 sm:p-1.5 rounded-md transition-colors ${
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
              <div className="pt-2 sm:pt-4">
                {ui.activeTab === 'dashboard' && <DashboardView />}
                {ui.activeTab === 'portfolio' && <PortfolioView />}
                {ui.activeTab === 'analytics' && <AnalyticsView />}
                {ui.activeTab === 'watchlist' && <WatchlistView />}
                {ui.activeTab === 'replay' && <SignalReplayView />}
                {ui.activeTab === 'execution' && <ExecutionView />}
                {ui.activeTab === 'cleanup' && <CleanupView />}
                {ui.activeTab === 'guide' && <InvestmentGuideView />}
                {ui.activeTab === 'settings' && <SettingsPage />}
              </div>
            </main>

            {showScrollTop && (
              <button
                onClick={() => mainRef.current?.scrollTo({ top: 0 })}
                className={`fixed right-4 sm:right-8 bg-gray-700 hover:bg-gray-600 text-white rounded-full p-3 shadow-lg transition-all z-[70] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-primary ${
                  derived.showAlertPopup ? 'bottom-20 sm:bottom-24' : 'bottom-4 sm:bottom-8'
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

            <button
              onClick={actions.openAssistant}
              className="fixed bottom-4 left-4 sm:bottom-8 sm:left-8 bg-primary hover:bg-primary-dark text-white rounded-full p-3 sm:p-4 shadow-lg transition-transform transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-primary"
              title="포트폴리오 어시스턴트 열기"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14 12c0 .552-.448 1-1 1s-1-.448-1-1 .448-1 1-1 1 .448 1 1zm-1-3.5c-2.481 0-4.5 2.019-4.5 4.5s2.019 4.5 4.5 4.5 4.5-2.019 4.5-4.5-2.019-4.5-4.5-4.5zm0-3.5c-4.411 0-8 3.589-8 8s3.589 8 8 8 8-3.589 8-8-3.589-8-8-8zm-5.5 8c0-3.033 2.468-5.5 5.5-5.5s5.5 2.467 5.5 5.5-2.468 5.5-5.5 5.5-5.5-2.467-5.5-5.5zm11.5 0c0 .828-.672 1.5-1.5 1.5s-1.5-.672-1.5-1.5.672-1.5 1.5-1.5 1.5.672 1.5 1.5z"/>
              </svg>
            </button>

            <PortfolioAssistant />

            {/* 투자 브리핑 팝업 */}
            {derived.showAlertPopup && (
              <AlertPopup
                results={derived.alertResults}
                riskMatrix={derived.riskMatrix}
                sellDataGaps={derived.sellDataGaps}
                executionSummary={derived.actionQueueSummary}
                showRiskMatrixExpanded={ui.signalDisplay.showRiskMatrixExpanded}
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
                  actions.setActiveTab('execution');
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
