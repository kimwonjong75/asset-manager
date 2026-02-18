import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AssetCategory } from './types';
import Header from './components/Header';
import EditAssetModal from './components/EditAssetModal';
import SellAssetModal from './components/SellAssetModal';
import BuyMoreAssetModal from './components/BuyMoreAssetModal';
import BulkUploadModal from './components/BulkUploadModal';
import AddNewAssetModal from './components/AddNewAssetModal';
import PortfolioAssistant from './components/PortfolioAssistant';
import PeriodSelector from './components/common/PeriodSelector';
import AlertPopup from './components/common/AlertPopup';
import AlertSettingsPage from './components/AlertSettingsPage';

// Hooks
import { PortfolioProvider, usePortfolio } from './contexts/PortfolioContext';

// Layouts
import DashboardView from './components/layouts/DashboardView';
import PortfolioView from './components/layouts/PortfolioView';
import AnalyticsView from './components/layouts/AnalyticsView';
import WatchlistView from './components/layouts/WatchlistView';
import InvestmentGuideView from './components/layouts/InvestmentGuideView';

type ActiveTab = 'dashboard' | 'portfolio' | 'analytics' | 'watchlist' | 'guide' | 'settings';

const AppContent: React.FC = () => {
  const { data, status, ui, modal, actions, derived } = usePortfolio();
  

  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [fileName, setFileName] = useState<string>('portfolio.json');




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
          className={`py-4 px-1 text-center border-b-2 font-medium text-sm focus:outline-none transition-colors duration-300 ${isActive ? activeClasses : inactiveClasses}`}
        >
          {children}
        </button>
    );
  };

  return (
    <div className="min-h-screen bg-gray-900 font-sans p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <Header 
          onSave={actions.saveToDrive} 
          onImport={actions.importJsonPrompt}
          onExport={() => actions.exportJson()}
          onExportToCsv={actions.exportCsv}
          onOpenBulkUploadModal={actions.openBulkUpload}
          onOpenAddAssetModal={actions.openAddAsset}
          onSignIn={actions.signIn}
          onSignOut={actions.signOut}
          isSignedIn={status.isSignedIn}
          userEmail={status.userEmail}
        />
        
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
          {status.successMessage && (
            <div className="bg-success/90 text-white px-4 py-3 rounded-lg shadow-lg flex justify-between items-center pointer-events-auto">
              <span className="block sm:inline">{status.successMessage}</span>
              <button className="ml-4 text-white/80 hover:text-white transition" onClick={() => actions.clearSuccessMessage()}>✕</button>
            </div>
          )}
          {status.error && (
            <div className="bg-danger/90 text-white px-4 py-3 rounded-lg shadow-lg flex justify-between items-center pointer-events-auto">
              <span className="block sm:inline">{status.error}</span>
              <button className="ml-4 text-white/80 hover:text-white transition" onClick={() => actions.clearError()}>✕</button>
            </div>
          )}
        </div>

        {status.isSignedIn ? (
          <>
            <div className="border-b border-gray-700">
              <div className="flex items-center justify-between">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                  <TabButton tabId="dashboard" onClick={() => actions.setActiveTab('dashboard')}>대시보드</TabButton>
                  <TabButton tabId="portfolio" onClick={() => actions.setActiveTab('portfolio')}>포트폴리오 상세</TabButton>
                  <TabButton tabId="watchlist" onClick={() => actions.setActiveTab('watchlist')}>관심종목</TabButton>
                  <TabButton tabId="analytics" onClick={() => actions.setActiveTab('analytics')}>수익 통계</TabButton>
                  <TabButton tabId="guide" onClick={() => actions.setActiveTab('guide')}>투자 가이드</TabButton>
                  <TabButton tabId="settings" onClick={() => actions.setActiveTab('settings')}>
                    <span className="flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      설정
                    </span>
                  </TabButton>
                </nav>
                {ui.activeTab !== 'guide' && ui.activeTab !== 'settings' && (
                  <PeriodSelector value={ui.globalPeriod} onChange={actions.setGlobalPeriod} />
                )}
              </div>
            </div>

            <main className="mt-8">
              {ui.activeTab === 'dashboard' && (
                <DashboardView />
              )}

              {ui.activeTab === 'portfolio' && (
                <PortfolioView />
              )}

              {ui.activeTab === 'analytics' && (
                <AnalyticsView />
              )}
              
              {ui.activeTab === 'watchlist' && (
                <WatchlistView />
              )}

              {ui.activeTab === 'guide' && (
                <InvestmentGuideView />
              )}

              {ui.activeTab === 'settings' && (
                <AlertSettingsPage />
              )}
            </main>
            
            <EditAssetModal />
            <SellAssetModal />
            <BuyMoreAssetModal />
            <BulkUploadModal />
            <AddNewAssetModal />

            <button
              onClick={actions.openAssistant}
              className="fixed bottom-8 right-8 bg-primary hover:bg-primary-dark text-white rounded-full p-4 shadow-lg transition-transform transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-primary"
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
                onClose={actions.dismissAlertPopup}
              />
            )}
          </>
        ) : (
          <div className="mt-12 bg-gray-800 border border-gray-700 rounded-lg p-8 text-center text-gray-200">
            <h2 className="text-2xl font-semibold mb-4">Google Drive 로그인 필요</h2>
            <p className="text-gray-400">
              포트폴리오 데이터는 Google Drive에만 저장됩니다. 상단의 로그인 버튼을 눌러 계정에 연결한 뒤 이용해주세요.
            </p>
          </div>
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
