import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { PortfolioSnapshot, Currency } from '../types';
import { isBaseType, getCategoryName, DEFAULT_CATEGORIES } from '../types/category';
import { createChart, IChartApi, ISeriesApi, LineSeries, HistogramSeries, LineStyle, ColorType, CrosshairMode } from 'lightweight-charts';
import { useHistoricalPriceData } from '../hooks/useHistoricalPriceData';
import { DEFAULT_MA_CONFIGS, MALineConfig, calculateSMA } from '../utils/maCalculations';
import { usePortfolio } from '../contexts/PortfolioContext';
import { getGlobalPeriodDays } from '../hooks/useGlobalPeriodDays';

const MA_PREFS_KEY = 'asset-manager-ma-preferences';

function loadMAConfigs(): MALineConfig[] {
  try {
    const stored = localStorage.getItem(MA_PREFS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as MALineConfig[];
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
  currentPrice: number;
  currency?: Currency;
  exchangeRate?: number;
  ticker?: string;
  exchange?: string;
  categoryId?: number;
  purchasePrice?: number;
}

/** 거래량 포맷 */
function formatVolume(vol: number): string {
  if (vol >= 1_0000_0000) return `${(vol / 1_0000_0000).toFixed(1)}억`;
  if (vol >= 1_0000) return `${(vol / 1_0000).toFixed(1)}만`;
  if (vol >= 1000) return `${(vol / 1000).toFixed(1)}K`;
  return vol.toLocaleString();
}

/** YYYY-MM-DD → lightweight-charts time format */
function toChartTime(dateStr: string): string {
  return dateStr; // lightweight-charts accepts YYYY-MM-DD strings
}

/** 통화 기호 */
function getCurrencySymbol(curr: string, showInKRW: boolean): string {
  if (showInKRW) return '₩';
  switch (curr) {
    case 'USD': return '$';
    case 'JPY': return '¥';
    case 'KRW': return '₩';
    default: return curr;
  }
}

/** 가격 포맷 */
function formatPrice(value: number, curr: Currency, showInKRW: boolean): string {
  const symbol = getCurrencySymbol(curr, showInKRW);
  const displayCurrency = showInKRW ? Currency.KRW : curr;
  const formatted = displayCurrency === Currency.KRW
    ? value.toLocaleString('ko-KR')
    : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol} ${formatted}`;
}

interface TooltipData {
  price: number;
  volume?: number;
  maValues: { period: number; color: string; value: number }[];
  date: string;
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
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeriesRefs = useRef<Map<number, ISeriesApi<'Line'>>>(new Map());
  const purchaseLineRef = useRef<ReturnType<ISeriesApi<'Line'>['createPriceLine']> | null>(null);
  const displayPurchasePriceRef = useRef<number | null>(null);
  const hasInitializedRangeRef = useRef<string | null>(null);

  const isCash = categoryId ? isBaseType(categoryId, 'CASH') : false;
  const enabledConfigs = maConfigs.filter(c => c.enabled);
  const enabledPeriods = enabledConfigs.map(c => c.period);
  const maxMAPeriod = enabledPeriods.length > 0 ? Math.max(...enabledPeriods) : 0;
  const hasMASupport = !!ticker && !!exchange && !!categoryId && !isCash;

  const { ui } = usePortfolio();
  const displayDays = getGlobalPeriodDays(ui.globalPeriod);

  const categoryName = categoryId ? getCategoryName(categoryId, DEFAULT_CATEGORIES) : undefined;
  const { historicalPrices, historicalVolumes, isLoading: maLoading, error: maError } = useHistoricalPriceData({
    ticker: ticker || '',
    exchange: exchange || '',
    category: categoryName,
    isExpanded: true,
    maxMAPeriod: hasMASupport ? maxMAPeriod : 0,
    displayDays,
  });

  const useHistoricalData = hasMASupport && !!historicalPrices && Object.keys(historicalPrices).length > 0;

  const handleToggleMA = useCallback((period: number) => {
    setMAConfigs(prev => {
      const next = prev.map(c =>
        c.period === period ? { ...c, enabled: !c.enabled } : c
      );
      saveMAConfigs(next);
      return next;
    });
  }, []);

  // 표시 통화 결정
  const displayCurrency = showInKRW ? Currency.KRW : currency;
  const applyKRW = showInKRW && currency !== Currency.KRW;

  // --- 데이터 준비 ---

  // 과거 종가 기반 데이터
  const priceData = useMemo(() => {
    if (useHistoricalData && historicalPrices) {
      const sortedDates = Object.keys(historicalPrices).sort();

      const points = sortedDates
        .map(date => ({
          time: toChartTime(date),
          value: applyKRW ? historicalPrices[date] * exchangeRate : historicalPrices[date],
        }));

      // 오늘 현재가 오버레이
      if (currentPrice > 0) {
        const todayISO = new Date().toISOString().split('T')[0];
        const displayCurrentPrice = applyKRW ? currentPrice * exchangeRate : currentPrice;
        const last = points[points.length - 1];
        if (last && last.time === todayISO) {
          last.value = displayCurrentPrice;
        } else {
          points.push({ time: todayISO, value: displayCurrentPrice });
        }
      }

      return points;
    }

    // PortfolioSnapshot 폴백
    const points = (history || [])
      .map(snapshot => {
        const assetSnapshot = snapshot.assets.find(a => a.id === assetId);
        let price = 0;
        if (assetSnapshot) {
          if (showInKRW || currency === Currency.KRW) {
            if (assetSnapshot.unitPrice !== undefined && assetSnapshot.unitPrice > 0) {
              price = assetSnapshot.unitPrice;
            } else if (assetSnapshot.unitPriceOriginal !== undefined && assetSnapshot.unitPriceOriginal > 0) {
              price = assetSnapshot.unitPriceOriginal * exchangeRate;
            } else if (currentQuantity > 0) {
              price = assetSnapshot.currentValue / currentQuantity;
            }
          } else {
            if (assetSnapshot.unitPriceOriginal !== undefined && assetSnapshot.unitPriceOriginal > 0) {
              price = assetSnapshot.unitPriceOriginal;
            } else if (assetSnapshot.unitPrice !== undefined && assetSnapshot.unitPrice > 0) {
              price = assetSnapshot.unitPrice / exchangeRate;
            } else if (currentQuantity > 0) {
              price = (assetSnapshot.currentValue / currentQuantity) / exchangeRate;
            }
          }
        }
        return { time: toChartTime(snapshot.date), value: price };
      })
      .filter(d => d.value > 0);

    if (currentPrice > 0) {
      const todayISO = new Date().toISOString().split('T')[0];
      const displayCurrentPrice = (showInKRW && currency !== Currency.KRW)
        ? currentPrice * exchangeRate
        : currentPrice;
      const last = points[points.length - 1];
      if (last && last.time === todayISO) {
        last.value = displayCurrentPrice;
      } else {
        points.push({ time: todayISO, value: displayCurrentPrice });
      }
    }

    return points;
  }, [useHistoricalData, historicalPrices, history, assetId, currentQuantity, currentPrice, currency, exchangeRate, showInKRW, applyKRW]);

  // 거래량 데이터
  const volumeData = useMemo(() => {
    if (!useHistoricalData || !historicalVolumes) return [];
    const sortedDates = Object.keys(historicalVolumes).sort();
    return sortedDates
      .filter(d => historicalVolumes[d] > 0)
      .map(date => ({
        time: toChartTime(date),
        value: historicalVolumes[date],
        color: 'rgba(74, 85, 104, 0.3)',
      }));
  }, [useHistoricalData, historicalVolumes]);

  const hasVolumeData = volumeData.length > 0;

  // MA 데이터
  const maDataMap = useMemo(() => {
    if (!useHistoricalData || !historicalPrices) return new Map<number, { time: string; value: number }[]>();
    const sortedDates = Object.keys(historicalPrices).sort();
    const sortedPrices = sortedDates.map(date => ({
      date,
      price: applyKRW ? historicalPrices[date] * exchangeRate : historicalPrices[date],
    }));

    const result = new Map<number, { time: string; value: number }[]>();
    for (const period of enabledPeriods) {
      const sma = calculateSMA(sortedPrices, period);
      const points: { time: string; value: number }[] = [];
      for (let i = 0; i < sortedPrices.length; i++) {
        if (sma[i] !== null) {
          points.push({ time: toChartTime(sortedPrices[i].date), value: Math.round(sma[i]! * 100) / 100 });
        }
      }
      result.set(period, points);
    }
    return result;
  }, [useHistoricalData, historicalPrices, enabledPeriods, applyKRW, exchangeRate]);

  // 매수평균가
  const displayPurchasePrice = useMemo(() => {
    if (!purchasePrice || purchasePrice <= 0) return null;
    if (showInKRW && currency !== Currency.KRW) {
      return purchasePrice * exchangeRate;
    }
    return purchasePrice;
  }, [purchasePrice, showInKRW, currency, exchangeRate]);

  // ref를 통해 autoscaleInfoProvider가 최신 값 참조
  displayPurchasePriceRef.current = displayPurchasePrice;

  // 선택 기간에 해당하는 visible range (데이터 전체는 차트에 로드, 초기 뷰만 제한)
  const visibleRange = useMemo(() => {
    if (displayDays === null || priceData.length === 0) return null;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - displayDays);
    const from = cutoff.toISOString().split('T')[0];
    const firstDate = priceData[0].time as string;
    const lastDate = priceData[priceData.length - 1].time as string;
    return { from: from > firstDate ? from : firstDate, to: lastDate };
  }, [displayDays, priceData]);

  // --- 차트 생성 및 업데이트 ---
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    // 차트 재생성 시 range 초기화 플래그 리셋 (데이터 useEffect에서 재적용)
    hasInitializedRangeRef.current = null;

    // 차트 생성
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#1F2937' },
        textColor: '#A0AEC0',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(74, 85, 104, 0.3)' },
        horzLines: { color: 'rgba(74, 85, 104, 0.3)' },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
      },
      rightPriceScale: {
        borderColor: '#4A5568',
        scaleMargins: { top: 0.05, bottom: showVolume && hasVolumeData ? 0.25 : 0.05 },
      },
      timeScale: {
        borderColor: '#4A5568',
        timeVisible: false,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
    });
    chartRef.current = chart;

    // 가격 라인 시리즈
    const priceSeries = chart.addSeries(LineSeries, {
      color: '#818CF8',
      lineWidth: 2,
      crosshairMarkerRadius: 5,
      priceFormat: {
        type: 'price',
        precision: displayCurrency === Currency.KRW ? 0 : 2,
        minMove: displayCurrency === Currency.KRW ? 1 : 0.01,
      },
      autoscaleInfoProvider: (baseImpl) => {
        const baseInfo = baseImpl();
        const pp = displayPurchasePriceRef.current;
        if (pp == null || !baseInfo || !baseInfo.priceRange) return baseInfo;
        return {
          ...baseInfo,
          priceRange: {
            minValue: Math.min(baseInfo.priceRange.minValue, pp),
            maxValue: Math.max(baseInfo.priceRange.maxValue, pp),
          },
        };
      },
    });
    priceSeriesRef.current = priceSeries;

    // 거래량 시리즈
    if (showVolume && hasVolumeData) {
      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      volSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeriesRef.current = volSeries;
    }

    // MA 시리즈
    const newMaSeriesMap = new Map<number, ISeriesApi<'Line'>>();
    for (const config of enabledConfigs) {
      const maSeries = chart.addSeries(LineSeries, {
        color: config.color,
        lineWidth: 1,
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      newMaSeriesMap.set(config.period, maSeries);
    }
    maSeriesRefs.current = newMaSeriesMap;

    // 크로스헤어 이벤트 (커스텀 툴팁)
    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        setTooltipData(null);
        setTooltipPos(null);
        return;
      }

      const priceValue = param.seriesData.get(priceSeries);
      if (!priceValue || !('value' in priceValue)) {
        setTooltipData(null);
        setTooltipPos(null);
        return;
      }

      const maValues: { period: number; color: string; value: number }[] = [];
      for (const config of enabledConfigs) {
        const series = newMaSeriesMap.get(config.period);
        if (series) {
          const v = param.seriesData.get(series);
          if (v && 'value' in v && v.value !== undefined) {
            maValues.push({ period: config.period, color: config.color, value: v.value as number });
          }
        }
      }

      let vol: number | undefined;
      if (volumeSeriesRef.current) {
        const vData = param.seriesData.get(volumeSeriesRef.current);
        if (vData && 'value' in vData) vol = vData.value as number;
      }

      setTooltipData({
        price: priceValue.value as number,
        volume: vol,
        maValues,
        date: String(param.time),
      });
      setTooltipPos({ x: param.point.x, y: param.point.y });
    });

    // 리사이즈 옵저버
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(container);

    // 모바일: 수평 터치는 차트가 처리, 수직 터치만 브라우저 스크롤
    container.style.touchAction = 'pan-y';

    // PC: 차트 영역 wheel 시 페이지 스크롤 방지
    // container 레벨에서 preventDefault만 호출 — lightweight-charts 내부 핸들러(canvas)가
    // bubble phase에서 먼저 처리한 후 container에서 브라우저 기본 스크롤만 차단
    const handleContainerWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    container.addEventListener('wheel', handleContainerWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleContainerWheel);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      volumeSeriesRef.current = null;
      maSeriesRefs.current = new Map();
      purchaseLineRef.current = null;
    };
    // 차트 인스턴스는 showVolume, enabledConfigs 변경 시 재생성
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVolume, hasVolumeData, enabledConfigs.map(c => c.period).join(','), displayCurrency]);

  // --- 데이터 업데이트 (차트 인스턴스 재생성 없이) ---
  useEffect(() => {
    if (!priceSeriesRef.current || priceData.length === 0) return;

    // 가격 데이터
    priceSeriesRef.current.setData(priceData as { time: string; value: number }[]);

    // 거래량 데이터
    if (volumeSeriesRef.current && volumeData.length > 0) {
      volumeSeriesRef.current.setData(volumeData as { time: string; value: number; color: string }[]);
    }

    // MA 데이터
    for (const [period, series] of maSeriesRefs.current) {
      const data = maDataMap.get(period);
      if (data) {
        series.setData(data as { time: string; value: number }[]);
      }
    }

    // 매수평균선
    if (purchaseLineRef.current) {
      try { priceSeriesRef.current.removePriceLine(purchaseLineRef.current); } catch { /* ignore */ }
      purchaseLineRef.current = null;
    }
    if (displayPurchasePrice != null) {
      purchaseLineRef.current = priceSeriesRef.current.createPriceLine({
        price: displayPurchasePrice,
        color: '#FFD700',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '매수평균',
      });
    }

    // 선택 기간에 맞게 시간축 조정 (종목+기간 조합당 한 번만 적용)
    // 사용자가 줌/드래그한 뷰는 보존, 기간 버튼 클릭 또는 종목 변경 시에만 재적용
    const rangeKey = `${assetId}-${displayDays}`;
    if (hasInitializedRangeRef.current !== rangeKey) {
      hasInitializedRangeRef.current = rangeKey;
      if (visibleRange) {
        chartRef.current?.timeScale().setVisibleRange({
          from: visibleRange.from,
          to: visibleRange.to,
        });
      } else {
        chartRef.current?.timeScale().fitContent();
      }
    }
  }, [priceData, volumeData, maDataMap, displayPurchasePrice, visibleRange, assetId, displayDays]);

  const hasMAToggle = hasMASupport;

  return (
    <div className="bg-gray-800 rounded-lg relative">
      <div className="flex justify-between items-center px-3 pt-3 pb-1">
        <h3 className="text-md font-bold text-white text-center flex-1">
          {`"${assetName}" 가격 추이 (${displayCurrency})`}
        </h3>

        {/* 통화 전환 토글 */}
        {currency !== Currency.KRW && (
          <button
            onClick={() => setShowInKRW(!showInKRW)}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-2 py-1 rounded border border-gray-600 transition-colors"
            title={showInKRW ? "외화로 보기" : "원화로 보기"}
          >
            {showInKRW ? `원화(${Currency.KRW})` : `외화(${currency})`}
          </button>
        )}
      </div>

      {/* MA 토글 칩 + 범례 */}
      {hasMAToggle && (
        <div className="flex items-center gap-1.5 px-3 pb-1 flex-wrap">
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
          {/* 범례 */}
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

      {/* 차트 컨테이너 */}
      {priceData.length > 0 ? (
        <div className="relative" style={{ height: hasMAToggle ? '280px' : '220px' }}>
          <div ref={chartContainerRef} className="w-full h-full" />

          {/* 커스텀 툴팁 */}
          {tooltipData && tooltipPos && (
            <div
              className="absolute pointer-events-none z-10 bg-gray-800/95 border border-gray-600 rounded-lg px-2.5 py-1.5 text-xs"
              style={{
                left: Math.min(tooltipPos.x + 12, (chartContainerRef.current?.clientWidth ?? 300) - 160),
                top: Math.max(tooltipPos.y - 60, 4),
              }}
            >
              <div className="text-gray-400 mb-0.5">{tooltipData.date}</div>
              <div className="text-white font-bold">
                현재가: {formatPrice(tooltipData.price, currency, showInKRW)}
              </div>
              {tooltipData.maValues.map(ma => (
                <div key={ma.period} style={{ color: ma.color }}>
                  MA{ma.period}: {formatPrice(ma.value, currency, showInKRW)}
                </div>
              ))}
              {tooltipData.volume !== undefined && tooltipData.volume > 0 && (
                <div className="text-gray-400">거래량: {formatVolume(tooltipData.volume)}</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center" style={{ height: '220px' }}>
          <p className="text-gray-500 text-sm">추이 데이터가 부족합니다.</p>
        </div>
      )}
    </div>
  );
};

export default AssetTrendChart;
