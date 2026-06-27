// components/replay/SignalReplayChart.tsx
// 신호 리플레이 전용 차트 (lightweight-charts v5). AssetTrendChart 와 의도적으로 분리:
//   · 외부 데이터(chartPoints) 주입 — 자체 fetch 없음, 오늘 현재가 덧붙이기 없음.
//   · replay 모드(기본)는 asOfDate 이후 데이터를 가린다(미래 누설 방지). review 모드는 전체 공개.
//   · 신호 마커(createSeriesMarkers) + 클릭/이동 시 onSelectDate → 그 날짜 기준 재현 표시.
// 렌더 전용(비즈니스 로직 없음).

import React, { useRef, useEffect, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode, CandlestickSeries, LineSeries,
  createSeriesMarkers, LineStyle,
  type IChartApi, type ISeriesApi, type SeriesMarker, type Time,
} from 'lightweight-charts';
import { CANDLE_UP_COLOR, CANDLE_DOWN_COLOR } from '../../utils/chartFormat';
import { buildReplayTooltip, RSI_ZONE_LABEL, type ReplayTooltipData, type RsiZone } from '../../utils/replayTooltip';
import { VERDICT_KIND_LABELS } from './ReplayVerdictPanel';
import type { ReplayChartPoint, ReplayMarker, ReplayMode, SignalVerdictKind } from '../../types/signalReplay';

interface SignalReplayChartProps {
  points: ReplayChartPoint[];
  markers: ReplayMarker[];
  asOfDate: string | null;
  mode: ReplayMode;
  onSelectDate: (date: string) => void;
  /** 날짜→내 판정 종류(별도 prop — 타임라인 무관 UI 상태). 툴팁 뱃지용. */
  verdicts?: Map<string, SignalVerdictKind[]>;
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
const MA_PERIODS = MA_LINES.map(c => c.period);
const MA_COLOR: Record<number, string> = Object.fromEntries(MA_LINES.map(c => [c.period, c.color]));
const RSI_COLOR = '#e879f9';
const RSI_PANE_HEIGHT = 90;

const RSI_ZONE_TONE: Record<RsiZone, string> = {
  oversold: 'text-sky-300',
  neutral: 'text-gray-400',
  'near-overbought': 'text-amber-300',
  overbought: 'text-rose-300',
};

function hasFullOHLC(points: ReplayChartPoint[]): boolean {
  return points.length > 0 && points.every(p => p.open !== null && p.high !== null && p.low !== null);
}

// 가격/지표 표시 포맷 — 자릿수 가변(저가 코인 정밀도 보존).
const fmtNum = (v: number | null): string => {
  if (v == null) return '—';
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(4);
};
const fmtPct = (v: number | null): string => (v == null ? '' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
const fmtVol = (v: number): string =>
  v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v));

const MAX_ALERT_NAMES = 3; // 툴팁은 규칙명 최대 3개 — 상세는 진단 패널이 담당

const SignalReplayChart: React.FC<SignalReplayChartProps> = ({
  points, markers, asOfDate, mode, onSelectDate, verdicts, height = 430,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null>(null);
  const maSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const onSelectRef = useRef(onSelectDate);
  onSelectRef.current = onSelectDate;

  // hover 툴팁 — 데이터는 ReplayChartPoint/markers에서만(미래정보 0). 핸들러는 1회 등록 → 최신값은 ref로.
  const [tooltip, setTooltip] = useState<ReplayTooltipData | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const infoMapRef = useRef<Map<string, { point: ReplayChartPoint; prevClose: number | null }>>(new Map());
  const markerMapRef = useRef<Map<string, ReplayMarker[]>>(new Map());
  const verdictMapRef = useRef<Map<string, SignalVerdictKind[]>>(new Map());
  verdictMapRef.current = verdicts ?? new Map();
  const lastDateRef = useRef<string | null>(null);
  const asOfRef = useRef(asOfDate);
  asOfRef.current = asOfDate;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const useCandle = hasFullOHLC(points);

  // 날짜→포인트(+전일종가) / 날짜→마커 맵 — 툴팁 O(1) 조회용. hover 재렌더 시 재계산 안 함.
  useEffect(() => {
    const im = new Map<string, { point: ReplayChartPoint; prevClose: number | null }>();
    for (let i = 0; i < points.length; i++) {
      im.set(points[i].date, { point: points[i], prevClose: i > 0 ? points[i - 1].close : null });
    }
    infoMapRef.current = im;
    const mm = new Map<string, ReplayMarker[]>();
    for (const m of markers) { const arr = mm.get(m.date) ?? []; arr.push(m); mm.set(m.date, arr); }
    markerMapRef.current = mm;
  }, [points, markers]);

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

    // hover 툴팁 — "그 시점 숫자 확인" 요약. replay 모드에선 asOf 이후를 절대 노출 안 함(룩어헤드 0).
    const clearTip = () => { lastDateRef.current = null; setTooltip(null); setTooltipPos(null); };
    chart.subscribeCrosshairMove(param => {
      const t = param.time ? String(param.time) : null;
      if (!t || !param.point || param.point.x < 0 || param.point.y < 0) { clearTip(); return; }
      if (modeRef.current === 'replay' && asOfRef.current && t > asOfRef.current) { clearTip(); return; }
      const info = infoMapRef.current.get(t);
      if (!info) { clearTip(); return; }
      setTooltipPos({ x: param.point.x, y: param.point.y });
      if (lastDateRef.current === t) return; // 같은 봉 안에서 이동: 위치만 갱신(데이터 재빌드 생략)
      lastDateRef.current = t;
      setTooltip(buildReplayTooltip({
        point: info.point, prevClose: info.prevClose,
        markers: markerMapRef.current.get(t) ?? [], maPeriods: MA_PERIODS,
        verdictKinds: verdictMapRef.current.get(t) ?? [],
      }));
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
      <div className="relative">
        <div ref={containerRef} style={{ width: '100%', height }} className="rounded-lg overflow-hidden" />
        {tooltip && tooltipPos && (
          <div
            className="absolute pointer-events-none z-10 bg-gray-800/95 border border-gray-600 rounded-lg px-2.5 py-1.5 text-[11px] leading-tight shadow-lg"
            style={{
              left: Math.max(4, Math.min(tooltipPos.x + 14, (containerRef.current?.clientWidth ?? 320) - 200)),
              top: Math.min(Math.max(4, tooltipPos.y - 30), height - 175),
              maxWidth: 220,
            }}
          >
            {/* 헤더: 날짜 · 등락률 · 구루 신호 요약 */}
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-gray-300 font-mono">{tooltip.date}</span>
              {tooltip.changePct != null && (
                <span className={tooltip.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmtPct(tooltip.changePct)}</span>
              )}
              {tooltip.guru.map((g, i) => (
                <span key={i} className={g.kind === 'sell' ? 'text-rose-300' : 'text-emerald-300'}>
                  📍 구루 {g.kind === 'sell' ? '매도' : '매수'} {g.count}
                </span>
              ))}
            </div>
            <div className="text-white">종가 <span className="font-mono">{fmtNum(tooltip.close)}</span></div>
            {tooltip.hasOHLC && (
              <div className="text-gray-400">
                시/고/저 <span className="font-mono">{fmtNum(tooltip.open)} / {fmtNum(tooltip.high)} / {fmtNum(tooltip.low)}</span>
              </div>
            )}
            {tooltip.volume != null && tooltip.volume > 0 && (
              <div className="text-gray-400">거래량 <span className="font-mono">{fmtVol(tooltip.volume)}</span></div>
            )}
            <div className="mt-1 space-y-0.5">
              {tooltip.mas.map(m => (
                <div key={m.period} className="flex items-center gap-1.5">
                  <span style={{ color: MA_COLOR[m.period] }}>MA{m.period}</span>
                  <span className="font-mono text-gray-200">{fmtNum(m.value)}</span>
                  {m.distPct != null && (
                    <span className={m.distPct >= 0 ? 'text-emerald-400/80' : 'text-rose-400/80'}>{fmtPct(m.distPct)}</span>
                  )}
                </div>
              ))}
            </div>
            {tooltip.ma5vs20 && (
              <div className={`mt-0.5 ${tooltip.ma5vs20 === 'above' ? 'text-emerald-400' : tooltip.ma5vs20 === 'below' ? 'text-rose-400' : 'text-gray-400'}`}>
                {tooltip.ma5vs20 === 'above' ? 'MA5 > MA20' : tooltip.ma5vs20 === 'below' ? 'MA5 < MA20' : 'MA5 = MA20'}
              </div>
            )}
            <div className="mt-0.5">
              <span className="text-gray-400">RSI </span>
              <span className="font-mono text-gray-200">{fmtNum(tooltip.rsi)}</span>
              {tooltip.rsiZone && <span className={`ml-1 ${RSI_ZONE_TONE[tooltip.rsiZone]}`}>{RSI_ZONE_LABEL[tooltip.rsiZone]}</span>}
            </div>
            {/* 검증 가능 가격기반 알림 요약(규칙명 최대 3개) — 상세는 클릭 후 진단 패널 */}
            {tooltip.alerts && (tooltip.alerts.buy.length > 0 || tooltip.alerts.sell.length > 0) && (
              <div className="mt-1 border-t border-gray-700/50 pt-1">
                <div>
                  <span className="text-gray-400">가격알림</span>
                  {tooltip.alerts.sell.length > 0 && <span className="text-rose-400"> · 매도 {tooltip.alerts.sell.length}</span>}
                  {tooltip.alerts.buy.length > 0 && <span className="text-emerald-400"> · 매수 {tooltip.alerts.buy.length}</span>}
                </div>
                <div className="text-gray-500 text-[10px]">
                  {[...tooltip.alerts.sell, ...tooltip.alerts.buy].slice(0, MAX_ALERT_NAMES).join(', ')}
                  {[...tooltip.alerts.sell, ...tooltip.alerts.buy].length > MAX_ALERT_NAMES && ' …'}
                </div>
              </div>
            )}
            {tooltip.verdicts.length > 0 && (
              <div className="mt-1 text-amber-300">📝 내 판정: {tooltip.verdicts.map(k => VERDICT_KIND_LABELS[k]).join(', ')}</div>
            )}
            <div className="mt-1 text-[10px] text-gray-600">클릭하면 상세 진단</div>
          </div>
        )}
      </div>
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
