// components/trade-plan/TradePlanIntro.tsx
// 매매 계획 첫 실행 1회 안내(계획서 §4.6 row 1) — 편집기·일괄 마법사가 처음 열릴 때 공용으로 띄운다.
// [다시 보지 않기] 체크 시 localStorage에 영속(간단한 UI 플래그라 safeStorage 없이 일반 try-catch —
// PortfolioContext의 accountView/lowValueThreshold 등 다른 UI 플래그와 동일 관례).

import React, { useState } from 'react';
import { CalendarDays, Scissors, ShieldCheck } from 'lucide-react';

export const TRADE_PLAN_INTRO_SEEN_KEY = 'asset-manager-tradeplan-intro-seen';

export function hasSeenTradePlanIntro(): boolean {
  try {
    return localStorage.getItem(TRADE_PLAN_INTRO_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

interface IntroCard {
  icon: React.ReactNode;
  title: string;
  body: string;
}

const CARDS: IntroCard[] = [
  {
    icon: <CalendarDays className="h-5 w-5 text-primary-light" aria-hidden="true" />,
    title: '사기 전에 언제 팔지 정한다',
    body: '매수와 동시에 손절선·익절선·추세선을 정해두면, 오를 때도 내릴 때도 미리 정한 대로만 움직이면 됩니다.',
  },
  {
    icon: <ShieldCheck className="h-5 w-5 text-primary-light" aria-hidden="true" />,
    title: '한 종목에서 총자산의 1%만 잃는다',
    body: '손절선에 닿아도 전체 자산에서 잃는 돈은 미리 정한 한도(기본 1%) 안으로 제한됩니다.',
  },
  {
    icon: <Scissors className="h-5 w-5 text-primary-light" aria-hidden="true" />,
    title: '오르면 절반 팔고, 나머지는 추세선이 깨질 때 판다',
    body: '목표가(손절폭의 3배, 기본값)에 오면 절반을 먼저 팔아 이익을 확정하고, 나머지는 추세선(기본 20일 평균) 아래로 종가가 내려올 때까지 들고 갑니다.',
  },
];

interface TradePlanIntroProps {
  onDismiss: () => void;
  className?: string;
}

const TradePlanIntro: React.FC<TradePlanIntroProps> = ({ onDismiss, className = '' }) => {
  const [dontShowAgain, setDontShowAgain] = useState(true);

  const handleClose = () => {
    if (dontShowAgain) {
      try {
        localStorage.setItem(TRADE_PLAN_INTRO_SEEN_KEY, '1');
      } catch {
        /* ignore */
      }
    }
    onDismiss();
  };

  return (
    <div className={`bg-surface-muted border border-border-subtle rounded-card p-3.5 space-y-3 ${className}`}>
      <h3 className="text-sm font-bold text-white">매매 계획이란?</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {CARDS.map((c, i) => (
          <div key={i} className="bg-surface-elevated rounded-md p-2.5 space-y-1">
            <div className="leading-none">{c.icon}</div>
            <div className="text-xs font-semibold text-primary-light">{c.title}</div>
            <p className="text-xs text-gray-400 leading-relaxed">{c.body}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-0.5">
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="cursor-pointer"
          />
          다시 보지 않기
        </label>
        <button
          type="button"
          onClick={handleClose}
          className="text-xs font-medium bg-primary hover:bg-primary-dark text-white px-3 py-1.5 rounded-md transition-colors"
        >
          시작하기
        </button>
      </div>
    </div>
  );
};

export default TradePlanIntro;
