import React from 'react';

interface HeaderProps {
  onSignIn?: () => void;
}

/**
 * 로그인 화면 전용 헤더 — 타이틀 + Google 로그인 버튼.
 * 로그인 후에는 App.tsx의 통합 앱바(탭바)가 모든 액션(자산 추가, 저장, 계정 메뉴)을 담당한다.
 */
const Header: React.FC<HeaderProps> = ({ onSignIn }) => {
  return (
    <header className="mb-2 sm:mb-8">
      <div className="flex justify-between items-center">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-4xl font-bold text-white tracking-tight truncate" title="나의 자산 포트폴리오를 관리하는 대시보드입니다.">
            KIM'S 퀸트자산관리
          </h1>
          <p className="text-gray-400 mt-1 sm:mt-2 text-sm sm:text-base hidden sm:block" title="계량적 투자 전략을 기반으로 자산을 분석하고 추적합니다.">
            퀀트 투자를 위한 포트폴리오 대시보드
          </p>
        </div>
        <button
          onClick={onSignIn}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-3 sm:px-4 rounded-md transition duration-300 flex items-center gap-2 text-sm sm:text-base flex-shrink-0"
          title="Google 계정으로 로그인하여 Google Drive에 저장합니다."
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          <span className="hidden sm:inline">로그인</span>
        </button>
      </div>
    </header>
  );
};

export default Header;
