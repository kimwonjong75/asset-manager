// components/today/PrepareSection.tsx
// "준비" 등급(손절 근접/불타기선 근접) — 기본 접힘(급하지 않은 항목이 화면을 채우지 않도록).
// 접혀 있어도 건수 배지는 항상 보인다(신호 은폐 금지 — TodayTurtleCard/GuruSignalCard와 동일 규약).

import React, { useState } from 'react';
import { Hourglass } from 'lucide-react';
import type { TradePlanSignalRow } from '../../hooks/useTradePlanSignals';
import TierRowList from './TierRowList';
import SectionHeader from '../common/SectionHeader';

export interface PrepareSectionProps {
  rows: TradePlanSignalRow[];
}

const STORAGE_KEY = 'asset-manager-today-prepare-open';

const PrepareSection: React.FC<PrepareSectionProps> = ({ rows }) => {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
  });
  if (rows.length === 0) return null;

  const toggle = () => setOpen(prev => {
    const next = !prev;
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* ignore */ }
    return next;
  });

  return (
    <section>
      <div className="mb-2">
        <SectionHeader
          title="준비"
          count={rows.length}
          tone="warning"
          icon={<Hourglass className="h-4 w-4 text-amber-400" aria-hidden="true" />}
          collapsible
          open={open}
          onToggle={toggle}
        />
      </div>
      {open && <TierRowList rows={rows} />}
    </section>
  );
};

export default PrepareSection;
