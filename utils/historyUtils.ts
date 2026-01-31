import { PortfolioSnapshot, SellRecord } from '../types';

/**
 * 히스토리에서 누락된 날짜를 마지막 데이터로 보간
 * - 마지막 스냅샷과 오늘 사이의 빈 날짜를 채움
 * - 주말도 포함 (시장 휴장일 구분 없이)
 */
export const fillMissingDates = (history: PortfolioSnapshot[]): PortfolioSnapshot[] => {
  if (history.length === 0) return history;

  // 날짜순 정렬
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const lastSnapshot = sorted[sorted.length - 1];
  const lastDate = new Date(lastSnapshot.date);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 마지막 스냅샷이 오늘이거나 이후면 보간 불필요
  if (lastDate >= today) return sorted;

  const filled: PortfolioSnapshot[] = [...sorted];
  const current = new Date(lastDate);
  current.setDate(current.getDate() + 1);

  while (current < today) {
    filled.push({
      date: current.toISOString().slice(0, 10),
      assets: lastSnapshot.assets.map(a => ({ ...a })),
    });
    current.setDate(current.getDate() + 1);
  }

  return filled;
};

/**
 * 히스토리 중간에 빠진 날짜도 보간 (선형 보간 아닌 이전 값 복사)
 */
export const fillAllMissingDates = (history: PortfolioSnapshot[]): PortfolioSnapshot[] => {
  if (history.length < 2) return fillMissingDates(history);

  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const filled: PortfolioSnapshot[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    filled.push(current);

    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      const currentDate = new Date(current.date);
      const nextDate = new Date(next.date);

      // 연속된 날짜가 아니면 중간 채우기
      currentDate.setDate(currentDate.getDate() + 1);
      while (currentDate < nextDate) {
        filled.push({
          date: currentDate.toISOString().slice(0, 10),
          assets: current.assets.map(a => ({ ...a })),
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
  }

  // 마지막 스냅샷부터 오늘까지도 채우기
  return fillMissingDates(filled);
};

/**
 * 매도 기록을 최근 1년과 아카이브로 분리
 */
export const archiveOldSellHistory = (sellHistory: SellRecord[]): {
  recent: SellRecord[];
  archived: SellRecord[];
} => {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const cutoffDate = oneYearAgo.toISOString().slice(0, 10);

  const recent = sellHistory.filter(r => r.sellDate >= cutoffDate);
  const archived = sellHistory.filter(r => r.sellDate < cutoffDate);

  return { recent, archived };
};

/**
 * 히스토리를 연도별로 분리
 */
export const splitHistoryByYear = (history: PortfolioSnapshot[]): Record<string, PortfolioSnapshot[]> => {
  const byYear: Record<string, PortfolioSnapshot[]> = {};

  for (const snapshot of history) {
    const year = snapshot.date.slice(0, 4);
    if (!byYear[year]) {
      byYear[year] = [];
    }
    byYear[year].push(snapshot);
  }

  return byYear;
};

/**
 * 최근 N일 히스토리만 추출
 */
export const getRecentHistory = (history: PortfolioSnapshot[], days: number = 30): PortfolioSnapshot[] => {
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  return sorted.slice(0, days).reverse();
};
