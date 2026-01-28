import React, { useEffect, useMemo, useState } from 'react';
import { Asset, Currency, SellRecord, AssetCategory, ALLOWED_CATEGORIES } from '../types';
import StatCard from './StatCard';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';

interface SellAnalyticsPageProps {
  assets: Asset[];
  sellHistory: SellRecord[];
}

type Grouping = 'daily' | 'weekly' | 'monthly' | 'quarterly';

const SellAnalyticsPage: React.FC<SellAnalyticsPageProps> = ({ assets, sellHistory }) => {
  const [grouping, setGrouping] = useState<Grouping>('monthly');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [category, setCategory] = useState<AssetCategory | 'ALL'>('ALL');

  const [pendingStartDate, setPendingStartDate] = useState<string>('');
  const [pendingEndDate, setPendingEndDate] = useState<string>('');
  const [pendingSearch, setPendingSearch] = useState<string>('');
  const [pendingCategory, setPendingCategory] = useState<AssetCategory | 'ALL'>('ALL');

  useEffect(() => {
    const today = new Date();
    const lastYear = new Date();
    lastYear.setFullYear(today.getFullYear() - 1);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const s = fmt(lastYear);
    const e = fmt(today);
    setStartDate(s);
    setEndDate(e);
    setPendingStartDate(s);
    setPendingEndDate(e);
  }, []);

  const allSellRecords: SellRecord[] = useMemo(() => {
    const inlineRecords: SellRecord[] = [];
    assets.forEach(a => {
      if (a.sellTransactions && a.sellTransactions.length > 0) {
        a.sellTransactions.forEach(t => {
          inlineRecords.push({
            assetId: a.id,
            ticker: a.ticker,
            name: a.name,
            category: a.category,
            ...t,
          });
        });
      }
    });
    return [...sellHistory, ...inlineRecords];
  }, [assets, sellHistory]);

  const filteredRecords = useMemo(() => {
    return allSellRecords.filter(r => {
      const d = r.sellDate;
      const inStart = !startDate || d >= startDate;
      const inEnd = !endDate || d <= endDate;
      const inSearch = !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.ticker.toLowerCase().includes(search.toLowerCase());
      const inCategory = category === 'ALL' || r.category === category;
      return inStart && inEnd && inSearch && inCategory;
    });
  }, [allSellRecords, startDate, endDate, search, category]);

  const toKRWPurchaseUnit = (a: Asset, quantity: number): number => {
    if (a.currency === Currency.KRW) return a.purchasePrice * quantity;
    if (a.purchaseExchangeRate) return a.purchasePrice * a.purchaseExchangeRate * quantity;
    if (a.priceOriginal > 0) {
      const ex = a.currentPrice / a.priceOriginal;
      return a.purchasePrice * ex * quantity;
    }
    return a.purchasePrice * quantity;
  };

  const toKRWPurchaseFromRecord = (r: SellRecord, quantity: number): number => {
    if (r.originalPurchasePrice && r.originalPurchasePrice > 0) {
      const currency = r.originalCurrency || Currency.KRW;
      if (currency === Currency.KRW) {
        return r.originalPurchasePrice * quantity;
      }
      const exchangeRate = r.originalPurchaseExchangeRate || 1;
      return r.originalPurchasePrice * exchangeRate * quantity;
    }
    return 0;
  };

  const recordWithCalc = useMemo(() => {
    const assetMap = new Map(assets.map(a => [a.id, a]));
    return filteredRecords.map(r => {
      const a = assetMap.get(r.assetId);
      // 스냅샷이 있으면 우선 사용, 없으면 현재 자산 정보 사용
      const snapshotPurchase = toKRWPurchaseFromRecord(r, r.sellQuantity);
      const purchaseKRW = snapshotPurchase > 0
        ? snapshotPurchase
        : (a ? toKRWPurchaseUnit(a, r.sellQuantity) : 0);
      const realized = r.sellPrice * r.sellQuantity - purchaseKRW;
      const returnPct = purchaseKRW === 0 ? 0 : (realized / purchaseKRW) * 100;
      return { ...r, purchaseKRW, realized, returnPct };
    });
  }, [filteredRecords, assets]);

  const overview = useMemo(() => {
    const totalSoldAmount = recordWithCalc.reduce((s, r) => s + r.sellPrice * r.sellQuantity, 0);
    const totalPurchase = recordWithCalc.reduce((s, r) => s + r.purchaseKRW, 0);
    const totalProfit = totalSoldAmount - totalPurchase;
    const totalReturn = totalPurchase === 0 ? 0 : (totalProfit / totalPurchase) * 100;
    const soldCount = recordWithCalc.length;
    return { totalSoldAmount, totalPurchase, totalProfit, totalReturn, soldCount };
  }, [recordWithCalc]);

  const groupKey = (dateStr: string): string => {
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const q = Math.floor((m - 1) / 3) + 1;
    if (grouping === 'daily') return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
    if (grouping === 'weekly') {
      const first = new Date(d);
      const day = first.getDay();
      const diff = first.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(first.setDate(diff));
      return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    }
    if (grouping === 'monthly') return `${y}-${String(m).padStart(2, '0')}`;
    return `${y}-Q${q}`;
  };

  const trendData = useMemo(() => {
    const map = new Map<string, { period: string; realized: number }>();
    recordWithCalc.forEach(r => {
      const k = groupKey(r.sellDate);
      const prev = map.get(k) || { period: k, realized: 0 };
      prev.realized += r.realized;
      map.set(k, prev);
    });
    return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
  }, [recordWithCalc, grouping]);

  const rankingData = useMemo(() => {
    const map = new Map<string, { name: string; realized: number; returnPct: number; count: number }>();
    recordWithCalc.forEach(r => {
      const prev = map.get(r.ticker) || { name: r.name, realized: 0, returnPct: 0, count: 0 };
      prev.realized += r.realized;
      prev.returnPct += r.returnPct;
      prev.count += 1;
      map.set(r.ticker, prev);
    });
    const arr = Array.from(map.entries()).map(([ticker, v]) => ({ ticker, name: v.name, realized: v.realized, avgReturn: v.count ? v.returnPct / v.count : 0 }));
    arr.sort((a, b) => b.avgReturn - a.avgReturn);
    return arr.slice(0, 10);
  }, [recordWithCalc]);

  const histogramData = useMemo(() => {
    if (recordWithCalc.length === 0) return [];
    const values = recordWithCalc.map(r => r.realized);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const bins = 10;
    const width = (max - min) / bins || 1;
    const buckets = Array.from({ length: bins }, (_, i) => ({ bucket: `${Math.round(min + i * width)}`, count: 0 }));
    values.forEach(v => {
      let idx = Math.floor((v - min) / width);
      if (idx < 0) idx = 0;
      if (idx >= bins) idx = bins - 1;
      buckets[idx].count += 1;
    });
    return buckets;
  }, [recordWithCalc]);

  const formatKRW = (num: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 p-4 rounded-lg shadow-lg flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-300">기간:</label>
            <input type="date" value={pendingStartDate} onChange={e => setPendingStartDate(e.target.value)} className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            <span className="text-gray-400">~</span>
            <input type="date" value={pendingEndDate} onChange={e => setPendingEndDate(e.target.value)} className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div className="relative">
            <select value={grouping} onChange={e => setGrouping(e.target.value as Grouping)} className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary appearance-none">
              <option value="daily">일별</option>
              <option value="weekly">주별</option>
              <option value="monthly">월별</option>
              <option value="quarterly">분기별</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
            </div>
          </div>
          <div className="relative">
            <select value={pendingCategory} onChange={e => setPendingCategory(e.target.value as AssetCategory | 'ALL')} className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary appearance-none">
              <option value="ALL">전체 카테고리</option>
              {ALLOWED_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
            </div>
          </div>
          <div className="relative">
            <input type="text" value={pendingSearch} onChange={e => setPendingSearch(e.target.value)} placeholder="종목명/티커 검색" className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-10 pr-10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary w-64" />
            <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
        <div>
          <button
            onClick={() => {
              setStartDate(pendingStartDate);
              setEndDate(pendingEndDate);
              setSearch(pendingSearch);
              setCategory(pendingCategory);
            }}
            className="bg-primary hover:bg-primary-dark text-white font-medium py-2 px-4 rounded-md transition duration-300 mr-2"
            title="선택된 조건으로 데이터를 조회합니다."
          >
            검색
          </button>
          <button
            onClick={() => {
              const header = ['sellDate','name','ticker','sellQuantity','sellPriceKRW','purchaseKRW','realized','returnPct'];
              const rows = recordWithCalc.map(r => [r.sellDate, r.name, r.ticker, r.sellQuantity, Math.round(r.sellPrice * r.sellQuantity), Math.round(r.purchaseKRW), Math.round(r.realized), r.returnPct.toFixed(2)]);
              const csv = [header.join(','), ...rows.map(row => row.join(','))].join('\n');
              const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'sell_analytics.csv';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
            className="bg-primary hover:bg-primary-dark text-white font-medium py-2 px-4 rounded-md transition duration-300"
            title="현재 필터 기준의 매도 통계 데이터를 CSV로 내보냅니다."
          >
            CSV 내보내기
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <StatCard title="총 매도금액" value={formatKRW(overview.totalSoldAmount)} tooltip="선택된 필터에 해당하는 매도 합계" />
        <StatCard title="매도 수익" value={formatKRW(overview.totalProfit)} isProfit={overview.totalProfit >= 0} tooltip="매도금액 - 매수원가" />
        <StatCard title="매도 수익률" value={`${overview.totalReturn.toFixed(2)}%`} isProfit={overview.totalReturn >= 0} tooltip="수익/매수원가" />
        <StatCard title="매도 횟수" value={String(overview.soldCount)} tooltip="거래 수" />
      </div>

      <div className="bg-gray-800 p-6 rounded-lg shadow-lg h-96">
        <h3 className="text-xl font-bold text-white mb-4">기간별 수익 추이</h3>
        {trendData.length > 0 ? (
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={trendData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
              <XAxis dataKey="period" stroke="#A0AEC0" fontSize={12} />
              <YAxis stroke="#A0AEC0" fontSize={12} tickFormatter={(v: number) => v.toLocaleString('ko-KR')} width={80} />
              <Tooltip formatter={(v: number) => [`${formatKRW(v)}`, '실현손익']} contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568', borderRadius: '0.5rem' }} labelStyle={{ color: '#E2E8F0' }} />
              <Legend wrapperStyle={{ fontSize: '12px', bottom: -10 }} />
              <Line type="monotone" dataKey="realized" name="실현손익" stroke="#FFFFFF" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">표시할 데이터가 없습니다.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
          <h3 className="text-xl font-bold text-white mb-4">종목별 수익률 순위(상위 10)</h3>
          {rankingData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={rankingData} layout="vertical" margin={{ left: 40, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
                <XAxis type="number" stroke="#A0AEC0" fontSize={12} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
                <YAxis type="category" dataKey="name" stroke="#A0AEC0" fontSize={12} width={160} />
                <Tooltip formatter={(v: number) => [`${(v as number).toFixed(2)}%`, '평균 수익률']} contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568', borderRadius: '0.5rem' }} />
                <Bar dataKey="avgReturn" name="평균 수익률">
                  {rankingData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.avgReturn >= 0 ? '#4ADE80' : '#F87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500">표시할 데이터가 없습니다.</p>
          )}
        </div>

        <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
          <h3 className="text-xl font-bold text-white mb-4">손익 분포(히스토그램)</h3>
          {histogramData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={histogramData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
                <XAxis dataKey="bucket" stroke="#A0AEC0" fontSize={12} tickFormatter={(v: string) => new Intl.NumberFormat('ko-KR').format(Number(v))} />
                <YAxis stroke="#A0AEC0" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568', borderRadius: '0.5rem' }} labelFormatter={(v) => `${v} KRW`} />
                <Bar dataKey="count" name="거래 수" fill="#34D399" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500">표시할 데이터가 없습니다.</p>
          )}
        </div>
      </div>

      {/* 매도 기록 리스트 */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
        <h3 className="text-xl font-bold text-white mb-4">매도 기록</h3>
        {recordWithCalc.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  <th className="py-3 px-3">매도일</th>
                  <th className="py-3 px-3">종목명</th>
                  <th className="py-3 px-3">티커</th>
                  <th className="py-3 px-3 text-right">수량</th>
                  <th className="py-3 px-3 text-right">매도금액</th>
                  <th className="py-3 px-3 text-right">매수금액</th>
                  <th className="py-3 px-3 text-right">실현손익</th>
                  <th className="py-3 px-3 text-right">수익률</th>
                </tr>
              </thead>
              <tbody>
                {recordWithCalc
                  .slice()
                  .sort((a, b) => b.sellDate.localeCompare(a.sellDate))
                  .map((r, idx) => {
                    const sellTotal = r.sellPrice * r.sellQuantity;
                    const isProfit = r.realized >= 0;
                    return (
                      <tr key={r.id || idx} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                        <td className="py-3 px-3 text-gray-300">{r.sellDate}</td>
                        <td className="py-3 px-3 text-white font-medium">{r.name}</td>
                        <td className="py-3 px-3 text-gray-400">{r.ticker}</td>
                        <td className="py-3 px-3 text-right text-gray-300">{r.sellQuantity.toLocaleString()}</td>
                        <td className="py-3 px-3 text-right text-gray-300">{formatKRW(sellTotal)}</td>
                        <td className="py-3 px-3 text-right text-gray-300">{r.purchaseKRW > 0 ? formatKRW(r.purchaseKRW) : '-'}</td>
                        <td className={`py-3 px-3 text-right font-semibold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                          {r.purchaseKRW > 0 ? formatKRW(r.realized) : '-'}
                        </td>
                        <td className={`py-3 px-3 text-right font-semibold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                          {r.purchaseKRW > 0 ? `${r.returnPct.toFixed(2)}%` : '-'}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">매도 기록이 없습니다.</p>
        )}
      </div>
    </div>
  );
};

export default SellAnalyticsPage;