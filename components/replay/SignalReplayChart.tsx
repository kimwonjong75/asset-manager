// components/replay/SignalReplayChart.tsx
// 신호 리플레이 전용 차트 (lightweight-charts v5). AssetTrendChart 와 의도적으로 분리:
//   · 외부 데이터(chartPoints) 주입 — 자체 fetch 없음, 오늘 현재가 덧붙이기 없음.
//   · replay 모드(기본)는 asOfDate 이후 데이터를 가린다(미래 누설 방지). review 모드는 전체 공개.
//   · 신호 마커(createSeriesMarkers) + 클릭/이동 시 onSelectDate → 그 날짜 기준 재현 표시.
// 렌더 전용(비즈니스 로직 없음).

import React, { useRef, useEffect } from 'react';
import {
  createChart, ColorType, CrosshairMode, CandlestickSeries, LineSeries,
  createSeriesMarkers,
  type IChartApi, type ISeriesApi, type SeriesMarker, type Time,
} from 'lightweight-charts';
import { CANDLE_UP_COLOR, CANDLE_DOWN_COLOR } from '../../utils/chartFormat';
import type { ReplayChartPoint, ReplayMarker, ReplayMode } from '../../types/signalReplay';

interface SignalReplayChartProps {
  points: ReplayChartPoint[];
  markers: ReplayMarker[];
  asOfDate: string | null;
  mode: ReplayMode;
  onSelectDate: (date: string) => void;
  height?: number;
}

function hasFullOHLC(points: ReplayChartPoint[]): boolean {
  return points.length > 0 && points.every(p => p.open !== null && p.high !== null && p.low !== null);
}

const SignalReplayChart: React.FC<SignalReplayChartProps> = ({
  points, markers, asOfDate, mode, onSelectDate, height = 360,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const onSelectRef = useRef(onSelectDate);
  onSelectRef.current = onSelectDate;
  const useCandle = hasFullOHLC(points);

  // 차트 생성 (1회) — 시리즈 종류(캔들/라인)는 데이터에 따라 결정되므로 useCandle 변경 시 재생성.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: 'rgba(75,85,99,0.2)' }, horzLines: { color: 'rgba(75,85,99,0.2)' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(75,85,99,0.4)' },
      timeScale: { borderColor: 'rgba(75,85,99,0.4)', timeVisible: false },
      height,
      autoSize: true,
    });
    const series = useCandle
      ? chart.addSeries(CandlestickSeries, {
          upColor: CANDLE_UP_COLOR, downColor: CANDLE_DOWN_COLOR,
          borderUpColor: CANDLE_UP_COLOR, borderDownColor: CANDLE_DOWN_COLOR,
          wickUpColor: CANDLE_UP_COLOR, wickDownColor: CANDLE_DOWN_COLOR,
        })
      : chart.addSeries(LineSeries, { color: '#22d3ee', lineWidth: 2 });

    chart.subscribeClick(param => {
      if (param.time) onSelectRef.current(String(param.time));
    });

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);

    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; markersRef.current = null; };
  }, [useCandle, height]);

  // 데이터 + 마커 갱신 (mode/asOf/points/markers 변경 시).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const visible = mode === 'replay' && asOfDate
      ? points.filter(p => p.date <= asOfDate)
      : points;

    if (useCandle) {
      (series as ISeriesApi<'Candlestick'>).setData(
        visible.map(p => ({ time: p.date as Time, open: p.open as number, high: p.high as number, low: p.low as number, close: p.close })),
      );
    } else {
      (series as ISeriesApi<'Line'>).setData(visible.map(p => ({ time: p.date as Time, value: p.close })));
    }

    // 신호 마커 (replay 모드면 asOf 이하만).
    const visibleMarkers = mode === 'replay' && asOfDate ? markers.filter(m => m.date <= asOfDate) : markers;
    const sm: SeriesMarker<Time>[] = visibleMarkers.map(m => ({
      time: m.date as Time,
      position: m.kind === 'sell' ? 'aboveBar' : 'belowBar',
      color: m.kind === 'sell' ? CANDLE_UP_COLOR : '#22c55e',
      shape: m.kind === 'sell' ? 'arrowDown' : 'arrowUp',
      text: m.kind === 'sell' ? `매도 ${m.guruCount || ''}` : `매수 ${m.guruCount || ''}`.trim(),
    }));
    // as-of 위치 강조 마커.
    if (asOfDate && (mode === 'review' || visible.some(p => p.date === asOfDate))) {
      sm.push({ time: asOfDate as Time, position: 'inBar', color: '#fbbf24', shape: 'circle', text: '◆' });
    }
    sm.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    markersRef.current?.setMarkers(sm);

    chartRef.current?.timeScale().fitContent();
  }, [points, markers, asOfDate, mode, useCandle]);

  return <div ref={containerRef} style={{ width: '100%', height }} className="rounded-lg overflow-hidden" />;
};

export default SignalReplayChart;
