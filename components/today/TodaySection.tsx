// components/today/TodaySection.tsx
// "오늘 실행" 등급(익절선 도달) — 항상 펼침. 렌더 전용, 계산은 utils/todayViewModel.

import React from 'react';
import { CircleCheck } from 'lucide-react';
import type { TradePlanSignalRow } from '../../hooks/useTradePlanSignals';
import TierRowList from './TierRowList';
import SectionHeader from '../common/SectionHeader';

export interface TodaySectionProps {
  rows: TradePlanSignalRow[];
}

const TodaySection: React.FC<TodaySectionProps> = ({ rows }) => {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="mb-2">
        <SectionHeader
          title="오늘 실행"
          count={rows.length}
          tone="ok"
          icon={<CircleCheck className="h-4 w-4 text-ok" aria-hidden="true" />}
        />
      </div>
      <TierRowList rows={rows} />
    </section>
  );
};

export default TodaySection;
