import { useMemo } from 'react';
import { GlobalPeriod } from '../types/store';

interface PeriodDateRange {
  startDate: string;
  endDate: string;
  days: number | null; // null = ALL (제한 없음)
}

const PERIOD_DAYS: Record<GlobalPeriod, number | null> = {
  'THIS_MONTH': null,
  'LAST_MONTH': null,
  '1M': 30,
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

function getMonthRange(period: 'THIS_MONTH' | 'LAST_MONTH'): { startDate: string; endDate: string } {
  const today = new Date();
  if (period === 'THIS_MONTH') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { startDate: formatDate(start), endDate: formatDate(today) };
  }
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  return { startDate: formatDate(lastMonthStart), endDate: formatDate(lastMonthEnd) };
}

export function useGlobalPeriodDays(period: GlobalPeriod): PeriodDateRange {
  return useMemo(() => {
    const today = new Date();
    const endDate = formatDate(today);

    if (period === 'THIS_MONTH' || period === 'LAST_MONTH') {
      const range = getMonthRange(period);
      return { startDate: range.startDate, endDate: range.endDate, days: null };
    }

    const days = PERIOD_DAYS[period];

    if (days === null) {
      return { startDate: '2000-01-01', endDate, days: null };
    }

    const start = new Date();
    start.setDate(start.getDate() - days);
    return { startDate: formatDate(start), endDate, days };
  }, [period]);
}
