import React, { useMemo, useState, useCallback, useRef } from 'react';
import { PortfolioSnapshot, Currency } from '../types';
import { isBaseType, getCategoryName, DEFAULT_CATEGORIES } from '../types/category';
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useHistoricalPriceData } from '../hooks/useHistoricalPriceData';
import { DEFAULT_MA_CONFIGS, MALineConfig, buildChartDataWithMA } from '../utils/maCalculations';
import { usePortfolio } from '../contexts/PortfolioContext';
import { getGlobalPeriodDays } from '../hooks/useGlobalPeriodDays';

const MA_PREFS_KEY = 'asset-manager-ma-preferences';

function loadMAConfigs(): MALineConfig[] {
  try {
    const stored = localStorage.getItem(MA_PREFS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as MALineConfig[];
      // 저장된 설정을 DEFAULT와 병합 (새 MA가 추가될 경우 대비)
      return DEFAULT_MA_CONFIGS.map(def => {
        const saved = parsed.find(p => p.period === def.period);
        return saved ? { ...def, enabled: saved.enabled } : def;
      });
    }
  } catch { /* ignore */ }
  return DEFAULT_MA_CONFIGS.map(c => ({ ...c }));
}

function saveMAConfigs(configs: MALineConfig[]): void {
  try {
    localStorage.setItem(MA_PREFS_KEY, JSON.stringify(configs));
  } catch { /* ignore */ }
}

interface AssetTrendChartProps {
  history: PortfolioSnapshot[];
  assetId: string;
  assetName: string;
  currentQuantity: number;
  currentPrice: number;       // 실시간 현재가 (외화 원본)
  currency?: Currency;        // 자산 통화 (USD, KRW, JPY...)
  exchangeRate?: number;      // 환율 (KRW 변환용)
  ticker?: string;
  exchange?: string;
  categoryId?: number;
  purchasePrice?: number;   // 매수평균가 (원화자산=KRW, 외화자산=원본통화)
}

/** 거래량 포맷 (1234567 → "123.5만", 1234567890 → "12.3억") */
function formatVolume(vol: number): string {
  if (vol >= 1_0000_0000) return `${(vol / 1_0000_0000).toFixed(1)}억`;
  if (vol >= 1_0000) return `${(vol / 1_0000).toFixed(1)}만`;
  if (vol >= 1000) return `${(vol / 1000).toFixed(1)}K`;
  return vol.toLocaleString();
}

const AssetTrendChart: React.FC<AssetTrendChartProps> = ({
  history,
  assetId,
  assetName,
  currentQuantity,
  currentPrice,
  currency = Currency.KRW,
  exchangeRate = 1,
  ticker,
  exchange,
  categoryId,
  purchasePrice,
}) => {
  const [showInKRW, setShowInKRW] = useState<boolean>(false);
  const [maConfigs, setMAConfigs] = useState<MALineConfig[]>(loadMAConfigs);
  const [showVolume, setShowVolume] = useState<boolean>(true);

  const isCash = categoryId ? isBaseType(categoryId, 'CASH') : false;
  const enabledConfigs = maConfigs.filter(c => c.enabled);
  const enabledPeriods = enabledConfigs.map(c => c.period);
  const maxMAPeriod = enabledPeriods.length > 0 ? Math.max(...enabledPeriods) : 0;
  const hasMASupport = !!ticker && !!exchange && !!categoryId && !isCash;

  const { ui } = usePortfolio();
  const displayDays = getGlobalPeriodDays(ui.globalPeriod);

  // 과거 시세 fetch (차트 열릴 때 항상 — 종가 기반 정확도 보장)
  // MA 비활성이어도 hook 내부에서 기본 기간으로 종가 데이터를 가져옴
  const categoryName = categoryId ? getCategoryName(categoryId, DEFAULT_CATEGORIES) : undefined;
  const { historicalPrices, historicalVolumes, isLoading: maLoading, error: maError } = useHistoricalPriceData({
    ticker: ticker || '',
    exchange: exchange || '',
    category: categoryName,
    isExpanded: true,
    maxMAPeriod: hasMASupport ? maxMAPeriod : 0,
    displayDays,
  });

  const handleToggleMA = useCallback((period: number) => {
    setMAConfigs(prev => {
      const next = prev.map(c =>
        c.period === period ? { ...c, enabled: !c.enabled } : c
      );
      saveMAConfigs(next);
      return next;
    });
  }, []);

  // 과거 종가 데이터가 있으면 우선 사용 (MA 활성 여부 무관), 없으면 PortfolioSnapshot 폴백
  const useHistoricalData = hasMASupport && !!historicalPrices && Object.keys(historicalPrices).length > 0;

  // 기존 PortfolioSnapshot 기반 차트 데이터
  const snapshotChartData = useMemo(() => {
    // 글로벌 기간 cutoff 계산
    let cutoffStr: string | null = null;
    if (displayDays !== null) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - displayDays);
      cutoffStr = cutoff.toISOString().split('T')[0];
    }

    const data = (history || [])
      .filter(snapshot => !cutoffStr || snapshot.date >= cutoffStr)
      .map(snapshot => {
      const assetSnapshot = snapshot.assets.find(a => a.id === assetId);

      let price = 0;
      if (assetSnapshot) {
        if (showInKRW || currency === Currency.KRW) {
            if (assetSnapshot.unitPrice !== undefined && assetSnapshot.unitPrice > 0) {
                price = assetSnapshot.unitPrice;
            }
            else if (assetSnapshot.unitPriceOriginal !== undefined && assetSnapshot.unitPriceOriginal > 0) {
                price = assetSnapshot.unitPriceOriginal * exchangeRate;
            }
            else if (currentQuantity > 0) {
                price = assetSnapshot.currentValue / currentQuantity;
            }
        }
        else {
            if (assetSnapshot.unitPriceOriginal !== undefined && assetSnapshot.unitPriceOriginal > 0) {
                price = assetSnapshot.unitPriceOriginal;
            }
            else if (assetSnapshot.unitPrice !== undefined && assetSnapshot.unitPrice > 0) {
                price = assetSnapshot.unitPrice / exchangeRate;
            }
            else if (currentQuantity > 0) {
                price = (assetSnapshot.currentValue / currentQuantity) / exchangeRate;
            }
        }
      }

      return {
        date: new Date(snapshot.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
        fullDate: snapshot.date,
        '현재가': price,
      };
    }).filter(d => d['현재가'] > 0);

    if (currentPrice > 0) {
      const today = new Date();
      const todayStr = today.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
      const todayISO = today.toISOString().split('T')[0];

      const displayCurrentPrice = (showInKRW && currency !== Currency.KRW)
        ? currentPrice * exchangeRate
        : currentPrice;

      const lastItem = data[data.length - 1];
      if (lastItem && (lastItem.date === todayStr || lastItem.fullDate === todayISO)) {
        lastItem['현재가'] = displayCurrentPrice;
      }
      else {
        data.push({
          date: todayStr,
          fullDate: todayISO,
          '현재가': displayCurrentPrice
        });
      }
    }

    return data;
  }, [history, assetId, currentQuantity, currentPrice, currency, exchangeRate, showInKRW, displayDays]);

  // 과거 종가 기반 차트 데이터 (+ MA 오버레이 + 거래량)
  const historicalChartData = useMemo(() => {
    if (!useHistoricalData || !historicalPrices) return [];

    // KRW 토글이 켜져있고 외화 자산이면 환율 적용
    const applyKRW = showInKRW && currency !== Currency.KRW;
    const processedPrices = applyKRW
      ? Object.fromEntries(
          Object.entries(historicalPrices).map(([date, price]) => [date, price * exchangeRate])
        )
      : historicalPrices;

    let data = buildChartDataWithMA(processedPrices, enabledPeriods, historicalVolumes);

    // 글로벌 기간으로 표시 범위 제한 (MA warm-up 구간 제거)
    if (displayDays !== null && data.length > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - displayDays);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      data = data.filter(d => !d.fullDate || d.fullDate >= cutoffStr);
    }

    // 오늘 날짜 실시간 currentPrice 오버레이
    if (currentPrice > 0 && data.length > 0) {
      const today = new Date();
      const todayStr = today.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
      const todayISO = today.toISOString().split('T')[0];

      const displayCurrentPrice = applyKRW
        ? currentPrice * exchangeRate
        : currentPrice;

      const lastItem = data[data.length - 1];
      if (lastItem && (lastItem.date === todayStr || lastItem.fullDate === todayISO)) {
        lastItem['현재가'] = displayCurrentPrice;
      } else {
        const newPoint: Record<string, string | number | undefined> = {
          date: todayStr,
          fullDate: todayISO,
          '현재가': displayCurrentPrice,
        };
        // MA 값은 오늘자 데이터에서는 계산 불가이므로 마지막 MA값을 이어서 표시
        for (const period of enabledPeriods) {
          const key = `MA${period}`;
          if (lastItem[key] !== undefined) {
            newPoint[key] = lastItem[key];
          }
        }
        data.push(newPoint as typeof data[number]);
      }
    }

    return data;
  }, [useHistoricalData, historicalPrices, historicalVolumes, enabledPeriods, currentPrice, currency, exchangeRate, showInKRW, displayDays]);

  const chartData = useHistoricalData ? historicalChartData : snapshotChartData;

  // 거래량 데이터 존재 여부
  const hasVolumeData = useMemo(() => {
    return chartData.some(d => d['거래량'] !== undefined && (d['거래량'] as number) > 0);
  }, [chartData]);

  // X축 연도 표시: 렌더된 tick 중 첫 등장 연도만 표시하기 위한 ref
  const renderedYearsRef = useRef(new Set<string>());
  // 각 렌더 사이클 시작 시 reset (tick 함수 호출 전에 실행됨)
  renderedYearsRef.current = new Set<string>();

  // 각 데이터 인덱스의 연도 미리 계산
  const yearByIndex = useMemo(() => {
    return chartData.map(d => {
      const fd = d.fullDate as string | undefined;
      return fd ? fd.substring(0, 4) : '';
    });
  }, [chartData]);

  // 통화 기호 표시 헬퍼 함수
  const getCurrencySymbol = (curr: string) => {
    if (showInKRW) return '₩';
    switch(curr) {
      case 'USD': return '$';
      case 'JPY': return '¥';
      case 'KRW': return '₩';
      default: return curr;
    }
  };

  // 표시 통화 결정
  const displayCurrency = showInKRW ? Currency.KRW : currency;

  // 툴팁 포맷터
  const formatTooltip = (value: number, name: string) => {
    if (name === '거래량') {
      return [formatVolume(value), '거래량'];
    }
    const symbol = getCurrencySymbol(currency);
    const formattedValue = displayCurrency === Currency.KRW
      ? value.toLocaleString('ko-KR')
      : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return [`${symbol} ${formattedValue}`, name];
  };

  // Y축 포맷터
  const formatYAxis = (value: number) => {
    if (displayCurrency === Currency.KRW) {
      if (value >= 10000) {
        return `${(value / 10000).toFixed(0)}만`;
      }
      return value.toLocaleString();
    }
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };

  // 매수평균가 표시 (통화 토글에 따라 변환)
  const displayPurchasePrice = useMemo(() => {
    if (!purchasePrice || purchasePrice <= 0) return null;
    if (showInKRW && currency !== Currency.KRW) {
      return purchasePrice * exchangeRate;
    }
    return purchasePrice;
  }, [purchasePrice, showInKRW, currency, exchangeRate]);

  // MA 토글 영역 높이 보정: MA 토글이 보이면 차트 높이 조정
  const hasMAToggle = hasMASupport;

  return (
    <div className={`bg-gray-800 p-4 rounded-lg relative ${hasMAToggle ? 'h-80' : 'h-64'}`}>
      <div className="flex justify-between items-center mb-1">
          <h3 className="text-md font-bold text-white text-center flex-1">
            {`"${assetName}" 가격 추이 (${displayCurrency})`}
          </h3>

          {/* 통화 전환 토글 (외화 자산인 경우에만 표시) */}
          {currency !== Currency.KRW && (
              <button
                  onClick={() => setShowInKRW(!showInKRW)}
                  className="absolute right-4 top-4 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-2 py-1 rounded border border-gray-600 transition-colors"
                  title={showInKRW ? "외화로 보기" : "원화로 보기"}
              >
                  {showInKRW ? `원화(${Currency.KRW})` : `외화(${currency})`}
              </button>
          )}
      </div>

      {/* MA 토글 칩 + 범례 */}
      {hasMAToggle && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-[10px] text-gray-500 mr-0.5">MA</span>
          {maConfigs.map(config => (
            <button
              key={config.period}
              onClick={() => handleToggleMA(config.period)}
              className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                config.enabled
                  ? 'text-white border-transparent'
                  : 'text-gray-400 border-gray-600 bg-transparent hover:border-gray-500'
              }`}
              style={config.enabled ? { backgroundColor: config.color, borderColor: config.color } : undefined}
            >
              {config.period}
            </button>
          ))}
          {/* VOL 토글 */}
          {hasVolumeData && (
            <button
              onClick={() => setShowVolume(!showVolume)}
              className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ml-1 ${
                showVolume
                  ? 'text-white bg-gray-600 border-gray-500'
                  : 'text-gray-400 border-gray-600 bg-transparent hover:border-gray-500'
              }`}
            >
              VOL
            </button>
          )}
          {maLoading && <span className="text-[10px] text-gray-500 ml-1">불러오는 중...</span>}
          {maError && !maLoading && <span className="text-[10px] text-red-400 ml-1">{maError}</span>}
          {/* 범례 (오른쪽 정렬) */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="flex items-center gap-1 text-[10px] text-gray-300">
              <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: '#818CF8' }} />현재가
            </span>
            {enabledConfigs.map(config => (
              <span key={config.period} className="flex items-center gap-1 text-[10px] text-gray-300">
                <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: config.color }} />MA{config.period}
              </span>
            ))}
            {displayPurchasePrice != null && (
              <span className="flex items-center gap-1 text-[10px] text-gray-300">
                <span className="inline-block w-3 h-0.5 rounded border-t border-dashed" style={{ borderColor: '#FFD700' }} />매수평균
              </span>
            )}
          </div>
        </div>
      )}

      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height="85%">
          <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 10, bottom: 18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
            <XAxis
              dataKey="date"
              stroke="#A0AEC0"
              fontSize={12}
              tick={({ x, y, payload }: { x: number; y: number; payload: { value: string; index?: number } }) => {
                const dataIndex = payload.index ?? 0;
                const year = yearByIndex[dataIndex] || '';
                const showYear = year !== '' && !renderedYearsRef.current.has(year);
                if (showYear) renderedYearsRef.current.add(year);
                return (
                  <g transform={`translate(${x},${y})`}>
                    <text x={0} y={0} dy={14} textAnchor="middle" fill="#A0AEC0" fontSize={12}>
                      {payload.value}
                    </text>
                    {showYear && (
                      <text x={0} y={0} dy={28} textAnchor="middle" fill="#8B9BB4" fontSize={10} fontWeight="bold">
                        {year}
                      </text>
                    )}
                  </g>
                );
              }}
            />
            {/* 가격 Y축 (좌측) */}
            <YAxis
              yAxisId="price"
              stroke="#A0AEC0"
              fontSize={12}
              tickFormatter={formatYAxis}
              domain={['auto', 'auto']}
              width={60}
            />
            {/* 거래량 Y축 (숨김 — 하단 1/4에 표시되도록 domain 조정) */}
            {showVolume && hasVolumeData && (
              <YAxis
                yAxisId="volume"
                orientation="right"
                stroke="transparent"
                tick={false}
                width={0}
                domain={[0, (dataMax: number) => dataMax * 4]}
              />
            )}
            <Tooltip
              formatter={formatTooltip}
              contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568', borderRadius: '0.5rem' }}
              labelStyle={{ color: '#E2E8F0' }}
              itemStyle={{ fontWeight: 'bold' }}
            />
            {/* 거래량 막대 (가격 라인 뒤에 렌더) */}
            {showVolume && hasVolumeData && (
              <Bar
                yAxisId="volume"
                dataKey="거래량"
                fill="#4A5568"
                opacity={0.3}
                isAnimationActive={false}
              />
            )}
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="현재가"
              stroke="#818CF8"
              strokeWidth={2}
              dot={{ r: enabledPeriods.length > 0 ? 0 : 3 }}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            />
            {/* 매수평균선 */}
            {displayPurchasePrice != null && (
              <ReferenceLine
                yAxisId="price"
                y={displayPurchasePrice}
                stroke="#FFD700"
                strokeDasharray="6 3"
                strokeWidth={1.5}
                label={({ viewBox }: { viewBox: { x: number; y: number; width: number } }) => {
                  const x = (viewBox.x ?? 0) + (viewBox.width ?? 0) + 4;
                  const y = viewBox.y ?? 0;
                  return (
                    <text x={x} y={y} fill="#FFD700" fontSize={10} dominantBaseline="auto">
                      <tspan x={x} dy="-2">매수</tspan>
                      <tspan x={x} dy="11">평균</tspan>
                    </text>
                  );
                }}
              />
            )}
            {/* 활성 MA 라인 동적 렌더링 */}
            {enabledConfigs.map(config => (
              <Line
                yAxisId="price"
                key={config.period}
                type="monotone"
                dataKey={`MA${config.period}`}
                stroke={config.color}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500 text-sm">추이 데이터가 부족합니다.</p>
        </div>
      )}
    </div>
  );
};

export default AssetTrendChart;
