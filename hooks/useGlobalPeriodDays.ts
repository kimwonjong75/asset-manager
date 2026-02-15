import { useMemo } from 'react';
import { GlobalPeriod } from '../types/store';

interface PeriodDateRange {
  startDate: string;
  endDate: string;
  days: number | null; // null = ALL (제한 없음)
}

const PERIOD_DAYS: Record<GlobalPeriod, number | null> = {
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '2Y': 730,
  'ALL': null,
};

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getGlobalPeriodDays(period: GlobalPeriod): number | null {
  return PERIOD_DAYS[period];
}

export function useGlobalPeriodDays(period: GlobalPeriod): PeriodDateRange {
  return useMemo(() => {
    const today = new Date();
    const endDate = formatDate(today);
    const days = PERIOD_DAYS[period];

    if (days === null) {
      return { startDate: '2000-01-01', endDate, days: null };
    }

    const start = new Date();
    start.setDate(start.getDate() - days);
    return { startDate: formatDate(start), endDate, days };
  }, [period]);
}
