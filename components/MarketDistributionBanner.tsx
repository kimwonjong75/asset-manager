// components/MarketDistributionBanner.tsx
// 대시보드 상단 시장 디스트리뷰션 배너
// - 모든 지수가 safe(0~2회)면 렌더링하지 않음 (노이즈 차단)
// - 3회 이상인 지수만 표시: 노랑(3) / 주황(4) / 빨강(5+)
// - 오닐 원의도: 시장 지수 디스트리뷰션 누적 = 시장 전체 위험 신호

import React from 'react';
import {
  useMarketDistributionDays,
  type MarketDistributionEntry,
  type MarketDistributionSeverity,
} from '../hooks/useMarketDistributionDays';
import Tooltip from './common/Tooltip';

// 라벨 뱃지 hover 시 표시 — 산식·단계·면책을 한 번에 설명 (3개 등급 공용)
const BANNER_TOOLTIP =
  "시장 지수의 '매물 출회일'을 세어 시장 전체의 위험을 진단하는 신호예요. (내 보유종목이 아니라 지수 자체 기준)\n📐 계산: 거래량이 50일 평균의 1.5배 이상인데 가격은 못 오른 날(음봉·윗꼬리·정체)을 '매물 출회일'로 셉니다. 최근 13거래일 기준.\n🚦 단계: 3회=주의(노랑) · 4회=약세(주황) · 5회 이상=시장 탈출(빨강). 2회 이하는 표시 안 함.\n💡 큰손이 물량을 던지는 날이 쌓일수록 시장이 약해진다는 오닐(W.O'Neil)의 진단 도구예요. 예측이 아닌 분위기 경고.";

const SEVERITY_STYLES: Record<Exclude<MarketDistributionSeverity, 'safe'>, {
  containerClass: string;
  dotClass: string;
  label: string;
  message: (count: number) => string;
}> = {
  attention: {
    containerClass: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200',
    dotClass: 'bg-yellow-400',
    label: '주의',
    message: count => `디스트리뷰션 ${count}회 — 매물 출회 누적, 신규 진입 주의`,
  },
  warning: {
    containerClass: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
    dotClass: 'bg-orange-400',
    label: '약세 신호',
    message: count => `디스트리뷰션 ${count}회 — 약세 전환 가능성, 비중 축소 검토`,
  },
  exit: {
    containerClass: 'border-red-500/40 bg-red-500/10 text-red-200',
    dotClass: 'bg-red-500',
    label: '시장 탈출',
    message: count => `디스트리뷰션 ${count}회 — 시장 전체 위험, 탈출/현금화 검토(오닐)`,
  },
};

const SEVERITY_ORDER: Record<MarketDistributionSeverity, number> = {
  exit: 0,
  warning: 1,
  attention: 2,
  safe: 3,
};

const MarketDistributionBanner: React.FC = () => {
  const { data } = useMarketDistributionDays();

  const visible = data
    .filter((e): e is MarketDistributionEntry & { count: number } =>
      e.severity !== 'safe' && typeof e.count === 'number'
    )
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  if (visible.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {visible.map(entry => {
        const styles = SEVERITY_STYLES[entry.severity as 'attention' | 'warning' | 'exit'];
        return (
          <div
            key={entry.ticker}
            className={`flex items-center gap-3 border rounded-lg px-4 py-2.5 text-sm ${styles.containerClass}`}
          >
            <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${styles.dotClass}`} />
            <span className="font-semibold">{entry.name}</span>
            <Tooltip content={BANNER_TOOLTIP} position="bottom" wrap className="cursor-help">
              <span className="text-xs px-1.5 py-0.5 rounded bg-black/30 inline-flex items-center gap-1">
                {styles.label}
                <span className="opacity-60">ⓘ</span>
              </span>
            </Tooltip>
            <span className="text-xs sm:text-sm">{styles.message(entry.count)}</span>
          </div>
        );
      })}
      <p className="text-[11px] text-gray-500 px-1">
        ※ 참고용 경고이며 투자자문이 아닙니다. 지수 디스트리뷰션은 시장 분위기 진단 도구입니다.
      </p>
    </div>
  );
};

export default MarketDistributionBanner;
