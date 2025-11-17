import React, { useEffect, useState } from 'react';

interface HeaderProps {
  onSave: () => void;
  onImport: () => void;
  onExport: () => void;
  onExportToCsv: () => void;
  onOpenBulkUploadModal: () => void;
  onOpenAddAssetModal: () => void;
  onSignIn?: () => void;
  onSignOut?: () => void;
  isSignedIn?: boolean;
  userEmail?: string | null;
}

const Header: React.FC<HeaderProps> = ({ 
  onSave, 
  onImport, 
  onExport, 
  onExportToCsv, 
  onOpenBulkUploadModal, 
  onOpenAddAssetModal,
  onSignIn,
  onSignOut,
  isSignedIn = false,
  userEmail,
}) => {
  const [showAdvancedMenu, setShowAdvancedMenu] = useState(false);

  useEffect(() => {
    if (!isSignedIn) {
      setShowAdvancedMenu(false);
    }
  }, [isSignedIn]);

  return (
    <header className="mb-8">
      <div className="flex justify-between items-start sm:items-center flex-col sm:flex-row">
        <div>
          <h1 className="text-4xl font-bold text-white tracking-tight" title="나의 자산 포트폴리오를 관리하는 대시보드입니다.">
            자산 관리 시트
          </h1>
          <p className="text-gray-400 mt-2" title="계량적 투자 전략을 기반으로 자산을 분석하고 추적합니다.">
            퀀트 투자를 위한 포트폴리오 대시보드
          </p>
        </div>
        <div className="flex items-center justify-end flex-wrap gap-2 mt-4 sm:mt-0">
          {isSignedIn ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400" title={`Google 계정으로 로그인됨: ${userEmail}`}>
                {userEmail}
              </span>
              <button
                onClick={onSignOut}
                className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-md transition duration-300"
                title="Google 계정에서 로그아웃합니다."
              >
                로그아웃
              </button>
            </div>
          ) : (
            <button
              onClick={onSignIn}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition duration-300 flex items-center gap-2"
              title="Google 계정으로 로그인하여 Google Drive에 저장합니다."
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              로그인
            </button>
          )}
          {isSignedIn && (
            <>
              <button
                onClick={onOpenAddAssetModal}
                className="bg-primary hover:bg-primary-dark text-white font-bold py-2 px-4 rounded-md transition duration-300"
                title="새로운 자산을 포트폴리오에 추가합니다."
              >
                신규 자산 추가
              </button>
              
              {/* 고급 기능 드롭다운 메뉴 */}
              <div className="relative">
                <button
                  onClick={() => setShowAdvancedMenu(!showAdvancedMenu)}
                  className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-md transition duration-300 flex items-center gap-1"
                  title="백업 및 일괄 등록 기능 메뉴"
                >
                  고급 기능
                  <svg className={`w-4 h-4 transition-transform ${showAdvancedMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {showAdvancedMenu && (
                  <div className="absolute right-0 mt-2 w-64 bg-gray-800 border border-gray-600 rounded-md shadow-lg z-50">
                    <div className="p-2">
                      <p className="text-xs text-gray-400 mb-2 px-2">
                        Google Drive에 저장된 데이터를 손쉽게 백업하거나 일괄 등록할 수 있습니다.
                      </p>
                      <div className="space-y-1">
                        <button
                          onClick={() => {
                            onOpenBulkUploadModal();
                            setShowAdvancedMenu(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded transition"
                          title="CSV 파일로 여러 자산을 한 번에 등록합니다."
                        >
                          <div className="font-medium">일괄 등록</div>
                          <div className="text-xs text-gray-500">CSV 파일로 여러 자산을 한 번에 등록</div>
                        </button>
                        <button
                          onClick={() => {
                            onImport();
                            setShowAdvancedMenu(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded transition"
                          title="JSON 파일에서 포트폴리오를 불러옵니다. (현재 데이터 덮어쓰기)"
                        >
                          <div className="font-medium">가져오기</div>
                          <div className="text-xs text-gray-500">JSON 파일에서 포트폴리오 불러오기</div>
                        </button>
                        <button
                          onClick={() => {
                            onExport();
                            setShowAdvancedMenu(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded transition"
                          title="현재 포트폴리오를 JSON 파일로 백업합니다."
                        >
                          <div className="font-medium">내보내기</div>
                          <div className="text-xs text-gray-500">현재 포트폴리오를 JSON 파일로 백업</div>
                        </button>
                    <button
                      onClick={() => {
                        onSave();
                        setShowAdvancedMenu(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded transition"
                      title="현재 데이터를 Google Drive에 즉시 저장합니다."
                    >
                      <div className="font-medium">Google Drive 저장</div>
                      <div className="text-xs text-gray-500">자동 저장 대기 없이 즉시 저장</div>
                    </button>
                        <button
                          onClick={() => {
                            onExportToCsv();
                            setShowAdvancedMenu(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded transition"
                          title="현재 포트폴리오를 CSV 파일로 내보냅니다."
                        >
                          <div className="font-medium">CSV로 내보내기</div>
                          <div className="text-xs text-gray-500">현재 포트폴리오를 CSV 파일로 내보내기</div>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* 메뉴 외부 클릭 시 닫기 */}
              {showAdvancedMenu && (
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowAdvancedMenu(false)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;