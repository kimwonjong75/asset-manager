// components/replay/SignalReplayChart.tsx
// 신호 리플레이 전용 차트 (lightweight-charts v5). AssetTrendChart 와 의도적으로 분리:
//   · 외부 데이터(chartPoints) 주입 — 자체 fetch 없음, 오늘 현재가 덧붙이기 없음.
//   · replay 모드(기본)는 asOfDate 이후 데이터를 가린다(미래 누설 방지). review 모드는 전체 공개.
//   · 신호 마커(createSeriesMarkers) + 클릭/이동 시 onSelectDate → 그 날짜 기준 재현 표시.
// 렌더 전용(비즈니스 로직 없음).

import React, { useRef, useEffect } from 'react';
import {
  createChart, ColorType, CrosshairMode, CandlestickSeries, LineSeries,
  createSeriesMarkers, LineStyle,
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

// 오버레이 MA — 5/20 은 골든·데드크로스 쌍이라 굵게/밝게, 장기선은 얇게. 색상은 아래 범례와 1:1.
const MA_LINES: { period: number; color: string; width: 1 | 2 }[] = [
  { period: 5, color: '#fbbf24', width: 2 },   // amber
  { period: 20, color: '#38bdf8', width: 2 },  // sky
  { period: 60, color: '#a78bfa', width: 1 },  // violet
  { period: 120, color: '#fb923c', width: 1 }, // orange
  { period: 150, color: '#94a3b8', width: 1 }, // slate
];
const RSI_COLOR = '#e879f9';
const RSI_PANE_HEIGHT = 90;

function hasFullOHLC(points: ReplayChartPoint[]): boolean {
  return points.length > 0 && points.every(p => p.open !== null && p.high !== null && p.low !== null);
}

const SignalReplayChart: React.FC<SignalReplayChartProps> = ({
  points, markers, asOfDate, mode, onSelectDate, height = 430,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null);
  const maSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
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

    // MA 오버레이(가격 pane=0) — 마지막값/가격라인/크로스헤어 마커는 끔(차트 잡음 최소화).
    const maSeries = MA_LINES.map(c =>
      chart.addSeries(LineSeries, {
        color: c.color, lineWidth: c.width,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      }),
    );

    // RSI 보조 pane(=1) + 과매수/과매도 기준선(70/30).
    const rsi = chart.addSeries(LineSeries, {
      color: RSI_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
    }, 1);
    rsi.createPriceLine({ price: 70, color: 'rgba(244,63,94,0.35)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '70' });
    rsi.createPriceLine({ price: 30, color: 'rgba(34,197,94,0.35)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '30' });
    const panes = chart.panes();
    if (panes.length > 1) panes[1].setHeight(RSI_PANE_HEIGHT);

    chart.subscribeClick(param => {
      if (param.time) onSelectRef.current(String(param.time));
    });

    chartRef.current = chart;
    seriesRef.current = series;
    maSeriesRef.current = maSeries;
    rsiSeriesRef.current = rsi;
    markersRef.current = createSeriesMarkers(series, []);

    return () => {
      chart.remove();
      chartRef.current = null; seriesRef.current = null;
      maSeriesRef.current = []; rsiSeriesRef.current = null; markersRef.current = null;
    };
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

    // MA 오버레이 — 워밍업 미충족(null)은 건너뛰어 선이 빈 구간 없이 이어지게.
    MA_LINES.forEach((c, idx) => {
      const ms = maSeriesRef.current[idx];
      if (!ms) return;
      ms.setData(
        visible
          .filter(p => p.ma && p.ma[c.period] != null)
          .map(p => ({ time: p.date as Time, value: p.ma[c.period] as number })),
      );
    });
    rsiSeriesRef.current?.setData(
      visible.filter(p => p.rsi != null).map(p => ({ time: p.date as Time, value: p.rsi as number })),
    );

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

  return (
    <div>
      <div ref={containerRef} style={{ width: '100%', height }} className="rounded-lg overflow-hidden" />
      {/* 색상 범례 — 차트 라인과 1:1. 골든/데드크로스는 MA5×MA20 교차. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 px-1 text-[10px]">
        {MA_LINES.map(c => (
          <span key={c.period} className="flex items-center gap-1 text-gray-400">
            <span className="inline-block w-3 h-[2px] rounded" style={{ backgroundColor: c.color }} />
            MA{c.period}
          </span>
        ))}
        <span className="flex items-center gap-1 text-gray-400">
          <span className="inline-block w-3 h-[2px] rounded" style={{ backgroundColor: RSI_COLOR }} />
          RSI(14) · 하단 패널(70/30 점선)
        </span>
      </div>
    </div>
  );
};

export default SignalReplayChart;
