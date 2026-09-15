// components/today/UrgentSection.tsx
// "긴급" 등급(손절선 도달/추세선 이탈) — 항상 펼침(미루면 안 되는 등급이라 접지 않는다).
// 계산은 utils/todayViewModel.groupRowsByTier가 이미 끝냈다 — 여기는 렌더만.

import React from 'react';
import { OctagonAlert } from 'lucide-react';
import type { TradePlanSignalRow } from '../../hooks/useTradePlanSignals';
import TierRowList from './TierRowList';
import SectionHeader from '../common/SectionHeader';

export interface UrgentSectionProps {
  rows: TradePlanSignalRow[];
}

const UrgentSection: React.FC<UrgentSectionProps> = ({ rows }) => {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="mb-2">
        {/* Stage B 색 규약: 긴급 = 주황 + 아이콘 + 문구 (빨강은 '오름' 전용) */}
        <SectionHeader
          title="긴급"
          count={rows.length}
          tone="warning"
          icon={<OctagonAlert className="h-4 w-4 text-warning" aria-hidden="true" />}
        />
      </div>
      <TierRowList rows={rows} />
    </section>
  );
};

export default UrgentSection;
