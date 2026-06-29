// components/layouts/SignalReplayView.tsx
// "신호 리플레이" 탭 — 구루 신호를 과거 종목에 대입해 타이밍을 검증하는 연구 도구(1차).
// 중심은 구루 신호 진단(왜 떴나/왜 안 떴나) + 신호 후 성과. 가격기반 알림은 "참고용"으로만 표기(조건 #4).
// 이 화면은 라이브 구루 신호/기존 알림 동작을 바꾸지 않는다(샌드박스/영구반영은 P3/P4).

import React, { useMemo, useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useSignalReplay, type ReplaySymbol } from '../../hooks/useSignalReplay';
import SignalReplayChart from '../replay/SignalReplayChart';
import ReplayVerdictPanel, { VERDICT_KIND_LABELS } from '../replay/ReplayVerdictPanel';
import ReplayCasesPanel from '../replay/ReplayCasesPanel';
import ReplaySandboxPanel from '../replay/ReplaySandboxPanel';
import ReplayPerformancePanel from '../replay/ReplayPerformancePanel';
import ReplayWinRatePanel from '../replay/ReplayWinRatePanel';
import ReplayMissedPanel from '../replay/ReplayMissedPanel';
import type { SignalVerdict, SignalVerdictKind } from '../../types/signalReplay';
import { describeRuleStatus } from '../../utils/guruDiagnostics';
import { describeAlertRuleStatus } from '../../utils/alertDiagnostics';
import { classifyReplayAlertScope, type ReplayAlertScope } from '../../utils/replayEval';
import { formatPct } from '../../utils/chartFormat';
import type { ReplayDay } from '../../types/signalReplay';
import type { RuleDiagnostic, StatusTone } from '../../types/knowledge';
import type { AlertRuleDiagnostic } from '../../types/alertDiagnostics';

const WINDOW_LABELS: Record<number, string> = { 126: '6개월', 252: '1년', 504: '2년', 756: '3년' };

const toneClass = (tone: StatusTone | 'positive' | 'neutral' | 'caution' | 'muted'): string => {
  switch (tone) {
    case 'positive': return 'text-emerald-400';
    case 'caution': return 'text-amber-400';
    case 'neutral': return 'text-gray-300';
    default: return 'text-gray-500';
  }
};

// 발화 우선 → 미충족(근접) → 데이터/미지원 → 비활성 순으로 정렬.
const STATUS_ORDER: Record<string, number> = {
  'firing': 0, 'firing-partial': 1, 'not-met': 2, 'not-met-partial': 3,
  'data-missing': 4, 'unsupported': 5, 'no-condition': 6, 'inactive': 7,
};

// 알림 진단 정렬(발화 우선). describeAlertRuleStatus.kind 기준.
const ALERT_STATUS_ORDER: Record<string, number> = {
  'firing': 0, 'firing-partial': 1, 'not-met': 2, 'not-met-partial': 3, 'data-missing': 4, 'disabled': 5,
};

const SCOPE_REASON: Record<Exclude<ReplayAlertScope, 'verifiable'>, string> = {
  'holding-dependent': '보유 단가 없음 — 손절·익절류(모의 0% 평가)',
  'server-dependent': '서버 매매신호·거래량 미수신',
};

// 진단 표시용 숫자/문자 포맷(정수는 그대로, 소수는 2자리).
const formatVal = (v: number | string | undefined): string =>
  v == null ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;

// 가격기반 알림 1건 진단 행 — 구루 행과 동형(상태 라벨 + 필터별 실제값/기준값).
const AlertRuleRow: React.FC<{ diag: AlertRuleDiagnostic }> = ({ diag }) => {
  const status = describeAlertRuleStatus(diag);
  return (
    <li className="bg-gray-900/50 rounded px-2.5 py-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm text-white truncate">
          <span className={`text-[10px] mr-1 ${diag.action === 'sell' ? 'text-rose-400' : 'text-emerald-400'}`}>
            {diag.action === 'sell' ? '매도' : '매수'}
          </span>
          {diag.ruleName}
        </span>
        <span className={`text-[11px] font-medium ${toneClass(status.tone)}`}>{status.label}</span>
      </div>
      {status.detail && <p className="text-[11px] text-gray-500 mt-0.5">{status.detail}</p>}
      {diag.filters.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {diag.filters.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5 flex-wrap text-[11px]">
              <span className={f.result === true ? 'text-emerald-400' : f.result === false ? 'text-rose-400' : 'text-gray-500'}>
                {f.result === true ? '✓' : f.result === false ? '✗' : '—'}
              </span>
              <span className="text-gray-300">{f.label}</span>
              {f.actual != null && <span className="text-white font-mono">{formatVal(f.actual)}</span>}
              {f.threshold != null && <span className="text-gray-500">(기준 {formatVal(f.threshold)})</span>}
            </div>
          ))}
        </div>
      )}
    </li>
  );
};

const GuruRuleRow: React.FC<{ diag: RuleDiagnostic; distances: (number | null)[] }> = ({ diag, distances }) => {
  const status = describeRuleStatus(diag);
  return (
    <li className="bg-gray-900/50 rounded px-2.5 py-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm text-white truncate">{diag.ruleTitle}</span>
        <span className={`text-[11px] font-medium ${toneClass(status.tone)}`}>{status.label}</span>
      </div>
      {status.detail && <p className="text-[11px] text-gray-500 mt-0.5">{status.detail}</p>}
      {diag.leaves.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {diag.leaves.map((lf, i) => {
            const d = distances[i];
            return (
              <div key={i} className="flex items-center gap-1.5 flex-wrap text-[11px]">
                <span className={lf.passed === true ? 'text-emerald-400' : lf.passed === false ? 'text-rose-400' : 'text-gray-500'}>
                  {lf.passed === true ? '✓' : lf.passed === false ? '✗' : '—'}
                </span>
                <span className="text-gray-300">{lf.label}</span>
                <span className="text-white font-mono">{lf.actual}</span>
                <span className="text-gray-500">(기준 {lf.condition})</span>
                {d !== null && (
                  <span className={d >= 0 ? 'text-emerald-500/80' : 'text-amber-500/80'}>
                    {d >= 0 ? `여유 ${d.toFixed(2)}` : `부족 ${d.toFixed(2)}`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
};

const OutcomeRow: React.FC<{ day: ReplayDay }> = ({ day }) => {
  const o = day.outcome;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
      {([['5일 후', o.ret5], ['20일 후', o.ret20], ['60일 후', o.ret60]] as const).map(([label, v]) => (
        <div key={label} className="bg-gray-900/50 rounded px-2 py-1.5">
          <div className="text-gray-500 text-[10px]">{label} 수익률</div>
          <div className={`font-mono ${v != null && v >= 0 ? 'text-emerald-400' : v != null ? 'text-rose-400' : 'text-gray-500'}`}>{formatPct(v)}</div>
        </div>
      ))}
      <div className="bg-gray-900/50 rounded px-2 py-1.5">
        <div className="text-gray-500 text-[10px]">신호 후 최대 상승</div>
        <div className="font-mono text-emerald-400">{formatPct(o.maxRise)}</div>
      </div>
      <div className="bg-gray-900/50 rounded px-2 py-1.5">
        <div className="text-gray-500 text-[10px]">신호 후 최대 하락</div>
        <div className="font-mono text-rose-400">{formatPct(o.maxDrop)}</div>
      </div>
    </div>
  );
};

const SignalReplayView: React.FC = () => {
  const { data, ui } = usePortfolio();
  const ctrl = useSignalReplay({ enabled: ui.activeTab === 'replay' });

  // 보유 + 관심종목 퀵픽(중복 ticker 제거).
  const quickPicks: ReplaySymbol[] = useMemo(() => {
    const seen = new Set<string>();
    const out: ReplaySymbol[] = [];
    for (const a of data.assets) {
      if (seen.has(a.ticker)) continue; seen.add(a.ticker);
      out.push({ ticker: a.ticker, name: a.customName?.trim() || a.name, exchange: a.exchange, categoryId: a.categoryId });
    }
    for (const w of data.watchlist) {
      if (seen.has(w.ticker)) continue; seen.add(w.ticker);
      out.push({ ticker: w.ticker, name: w.name, exchange: w.exchange, categoryId: w.categoryId });
    }
    return out;
  }, [data.assets, data.watchlist]);

  const day = ctrl.timeline?.days[ctrl.selectedIndex] ?? null;
  const sortedGuru = useMemo(() => {
    if (!day) return [];
    return [...day.guruDiagnostics].sort(
      (a, b) => (STATUS_ORDER[describeRuleStatus(a).kind] ?? 9) - (STATUS_ORDER[describeRuleStatus(b).kind] ?? 9),
    );
  }, [day]);
  // 가격기반 알림 진단 — 활성 규칙만, 리플레이 검증 가능/불가로 분리(검증 불가는 발화/미충족 판정을 신뢰 못 함).
  const alertView = useMemo(() => {
    const verifiable: AlertRuleDiagnostic[] = [];
    const unverifiable: { diag: AlertRuleDiagnostic; scope: ReplayAlertScope }[] = [];
    if (!day) return { verifiable, unverifiable };
    for (const d of day.alertDiagnostics) {
      if (!d.enabled) continue; // 꺼진 규칙은 실제 알림이 안 가므로 제외
      const scope = classifyReplayAlertScope(d.filters.map(f => f.filterKey));
      if (scope === 'verifiable') verifiable.push(d);
      else unverifiable.push({ diag: d, scope });
    }
    verifiable.sort(
      (a, b) => (ALERT_STATUS_ORDER[describeAlertRuleStatus(a).kind] ?? 9) - (ALERT_STATUS_ORDER[describeAlertRuleStatus(b).kind] ?? 9),
    );
    return { verifiable, unverifiable };
  }, [day]);
  const currentVerdict = ctrl.selectedDate ? ctrl.verdictFor(ctrl.selectedDate) : undefined;
  const hasSignal = !!(ctrl.selectedDate && ctrl.timeline?.signalDates.includes(ctrl.selectedDate));
  const hasAnyVerdict = !!(ctrl.selectedDate && ctrl.verdictDates.has(ctrl.selectedDate));
  // 판정 대상 선택지(그 날 평가된 구루 규칙) + 목록 라벨용 규칙명 맵.
  const ruleOptions = useMemo(() => sortedGuru.map(d => ({ ruleId: d.ruleId, title: d.ruleTitle })), [sortedGuru]);
  const ruleTitleById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of data.knowledgeBase.rules) m[r.id] = r.title;
    return m;
  }, [data.knowledgeBase.rules]);

  // 차트 hover 툴팁용 날짜→내 판정 종류 맵(배치2a) — 타임라인과 무관한 UI 상태라 별도 prop.
  const verdictKindsByDate = useMemo(() => {
    const m = new Map<string, SignalVerdictKind[]>();
    for (const v of ctrl.tickerVerdicts) {
      const arr = m.get(v.date) ?? [];
      if (!arr.includes(v.kind)) arr.push(v.kind);
      m.set(v.date, arr);
    }
    return m;
  }, [ctrl.tickerVerdicts]);

  // 놓친 신호 점프(④) — 현재 종목이면 날짜만, 퀵픽에 있으면 종목+시점, 둘 다 아니면 무시.
  const isResolvable = useMemo(() => {
    const set = new Set(quickPicks.map(q => q.ticker));
    return (ticker: string) => set.has(ticker);
  }, [quickPicks]);
  const onJumpMissed = (v: SignalVerdict): void => {
    if (ctrl.selected?.ticker === v.ticker) { ctrl.selectDate(v.date); return; }
    const sym = quickPicks.find(q => q.ticker === v.ticker);
    if (sym) ctrl.selectSymbolAtDate(sym, v.date);
  };

  // 검증 기록 가져오기(⑤) — 병합 결과 안내.
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일 재선택 허용
    if (!file) return;
    const res = await ctrl.importReplayRecords(file);
    setImportMsg(`가져옴: 판정 ${res.verdicts} · 사례 ${res.cases}`);
  };

  return (
    <div className="px-2 sm:px-4 pb-10 max-w-6xl mx-auto space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">🔁 신호 리플레이</h2>
        <p className="text-xs text-gray-500 mt-1">
          현재 활성 구루 규칙을 과거 가격에 다시 적용한 결과입니다 — <span className="text-gray-400">그날 실제 발송된 알림이 아닙니다.</span>
          시점을 옮기면 그날까지 데이터만으로 신호를 재계산합니다(미래 미반영).
        </p>
      </div>

      {/* 종목 선택 */}
      <div className="bg-gray-800 rounded-lg p-3 space-y-2">
        <div className="relative">
          <input
            value={ctrl.searchQuery}
            onChange={e => ctrl.setSearchQuery(e.target.value)}
            placeholder="종목 검색 (티커/이름) — 예: SLV, AAPL, 삼성전자"
            className="w-full bg-gray-900 text-sm text-white rounded px-3 py-2 border border-gray-700 focus:border-primary outline-none"
          />
          {(ctrl.searchResults.length > 0 || ctrl.isSearching) && (
            <ul className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto bg-gray-900 border border-gray-700 rounded shadow-lg">
              {ctrl.isSearching && <li className="px-3 py-2 text-xs text-gray-500">검색 중…</li>}
              {ctrl.searchResults.map(r => (
                <li
                  key={`${r.ticker}-${r.exchange}`}
                  onClick={() => ctrl.selectSymbol({ ticker: r.ticker, name: r.name, exchange: r.exchange, categoryId: 0 })}
                  className="px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 cursor-pointer flex items-center gap-2"
                >
                  <span className="text-white">{r.name}</span>
                  <span className="text-xs text-gray-500">{r.ticker}</span>
                  <span className="text-[10px] text-gray-600">{r.exchange}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {quickPicks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {quickPicks.map(s => (
              <button
                key={s.ticker}
                onClick={() => ctrl.selectSymbol(s)}
                className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                  ctrl.selected?.ticker === s.ticker
                    ? 'bg-primary/15 text-primary border-primary/40'
                    : 'bg-gray-900/60 text-gray-300 border-gray-700 hover:bg-gray-700'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {!ctrl.selected ? (
        <div className="bg-gray-900/50 rounded-lg px-4 py-10 text-center text-sm text-gray-500">
          종목을 검색하거나 위 칩에서 선택하면 과거 신호 리플레이가 시작됩니다.
        </div>
      ) : ctrl.isFetching ? (
        <div className="bg-gray-900/50 rounded-lg px-4 py-10 text-center text-sm text-gray-400">시세 불러오는 중…</div>
      ) : ctrl.fetchFailed ? (
        <div className="bg-gray-900/50 rounded-lg px-4 py-10 text-center text-sm text-rose-400">시세를 불러오지 못했습니다. 다른 종목을 시도해 주세요.</div>
      ) : (
        <>
          {/* 컨트롤 바 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded overflow-hidden border border-gray-700">
              {(['replay', 'review'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => ctrl.setMode(m)}
                  className={`text-xs px-3 py-1.5 ${ctrl.mode === m ? 'bg-primary/20 text-primary' : 'bg-gray-800 text-gray-400'}`}
                >
                  {m === 'replay' ? '리플레이(미래 숨김)' : '복기(미래 공개)'}
                </button>
              ))}
            </div>
            <div className="flex rounded overflow-hidden border border-gray-700">
              {ctrl.windowOptions.map(w => (
                <button
                  key={w}
                  onClick={() => ctrl.setWindowTradingDays(w)}
                  className={`text-xs px-2.5 py-1.5 ${ctrl.windowTradingDays === w ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400'}`}
                >
                  {WINDOW_LABELS[w] ?? w}
                </button>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-gray-500">
            📍 차트 마커와 이전/다음 신호 이동은 <span className="text-gray-400">구루 신호 기준</span>입니다. 골든/데드크로스·RSI 등 가격기반 알림은 아래 <span className="text-gray-400">‘가격기반 알림 진단’</span> 박스에서 확인하세요. 차트에는 MA5/20/60/120/150·RSI(14)가 겹쳐 표시됩니다.
          </p>

          {/* 차트 */}
          <div className="bg-gray-800 rounded-lg p-2">
            {ctrl.isComputing ? (
              <div className="h-[360px] flex items-center justify-center text-sm text-gray-500">신호 계산 중…</div>
            ) : ctrl.timeline && ctrl.timeline.chartPoints.length > 0 ? (
              <SignalReplayChart
                points={ctrl.timeline.chartPoints}
                markers={ctrl.timeline.markers}
                asOfDate={ctrl.selectedDate}
                mode={ctrl.mode}
                onSelectDate={ctrl.selectDate}
                verdicts={verdictKindsByDate}
              />
            ) : (
              <div className="h-[360px] flex items-center justify-center text-sm text-gray-500">데이터 부족 — 더 긴 기간을 선택하거나 다른 종목을 시도해 주세요.</div>
            )}
          </div>

          {/* 시점 이동 */}
          {ctrl.timeline && ctrl.timeline.days.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm text-white font-mono">
                  {ctrl.selectedDate}
                  {day && (
                    <span className={`ml-2 ${day.changePct != null && day.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatPct(day.changePct)}
                    </span>
                  )}
                  {hasAnyVerdict && (
                    <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-sans">📝 {currentVerdict ? VERDICT_KIND_LABELS[currentVerdict.kind] : '판정 있음'}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={ctrl.goPrevSignal} className="text-[11px] px-2 py-1 rounded bg-gray-900 text-gray-300 hover:bg-gray-700">◀ 이전 신호</button>
                  <button onClick={ctrl.goPrevDay} className="text-[11px] px-2 py-1 rounded bg-gray-900 text-gray-300 hover:bg-gray-700">−1일</button>
                  <button onClick={ctrl.goNextDay} className="text-[11px] px-2 py-1 rounded bg-gray-900 text-gray-300 hover:bg-gray-700">+1일</button>
                  <button onClick={ctrl.goNextSignal} className="text-[11px] px-2 py-1 rounded bg-gray-900 text-gray-300 hover:bg-gray-700">다음 신호 ▶</button>
                  <button onClick={ctrl.goLatest} className="text-[11px] px-2 py-1 rounded bg-gray-900 text-gray-300 hover:bg-gray-700">최신</button>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, ctrl.timeline.days.length - 1)}
                value={ctrl.selectedIndex}
                onChange={e => ctrl.selectIndex(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="text-[11px] text-gray-500">구루 신호 발생일 {ctrl.timeline.signalDates.length}개 · 거래일 {ctrl.timeline.days.length}개</div>
            </div>
          )}

          {/* 신호 상세 */}
          {day && (
            <div className="grid lg:grid-cols-2 gap-4">
              {/* 구루 신호 진단 (중심) */}
              <div className="bg-gray-800 rounded-lg p-3">
                <h3 className="text-sm font-bold text-white mb-2">🧭 구루 신호 진단 — 왜 떴나 / 왜 안 떴나</h3>
                {sortedGuru.length === 0 ? (
                  <p className="text-xs text-gray-500">평가할 구루 신호 규칙이 없습니다.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {sortedGuru.map(diag => (
                      <GuruRuleRow key={diag.ruleId} diag={diag} distances={day.guruLeafDistances[diag.ruleId] ?? []} />
                    ))}
                  </ul>
                )}
              </div>

              {/* 성과 + 가격기반 알림(참고용) */}
              <div className="space-y-4">
                <div className="bg-gray-800 rounded-lg p-3">
                  <h3 className="text-sm font-bold text-white mb-2">📈 신호 후 결과 {ctrl.mode === 'replay' && <span className="text-[11px] text-gray-500 font-normal">(복기 모드에서 차트로도 확인)</span>}</h3>
                  <OutcomeRow day={day} />
                </div>
                <div className="bg-gray-800 rounded-lg p-3">
                  <h3 className="text-sm font-bold text-gray-200 mb-1">🔔 가격기반 알림 진단 <span className="text-[11px] text-gray-500 font-normal">— 실제 자동 팝업으로 가는 신호</span></h3>
                  <p className="text-[11px] text-gray-600 mb-2">그날 가격기반 알림이 떴는지/왜 안 떴는지(실제값 vs 기준값). <span className="text-gray-500">미래에 앱이 알림을 보내는 경로는 이쪽입니다 — 검증 무게를 여기에 두세요.</span></p>
                  {alertView.verifiable.length === 0 ? (
                    <p className="text-xs text-gray-500">평가할 가격기반 알림이 없습니다.</p>
                  ) : (
                    <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                      {alertView.verifiable.map(d => <AlertRuleRow key={d.ruleId} diag={d} />)}
                    </ul>
                  )}
                  {alertView.unverifiable.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-700/60">
                      <div className="text-[11px] text-amber-400/90 mb-1">⚠ 리플레이 검증 불가 <span className="text-gray-600 font-normal">— 발화/미충족 판정을 믿지 마세요(‘놓친 매도’로 태깅 금지)</span></div>
                      <ul className="space-y-1">
                        {alertView.unverifiable.map(({ diag, scope }) => (
                          <li key={diag.ruleId} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-gray-400 truncate">{diag.action === 'sell' ? '매도' : '매수'} · {diag.ruleName}</span>
                            <span className="text-gray-600 whitespace-nowrap">{SCOPE_REASON[scope as Exclude<ReplayAlertScope, 'verifiable'>]}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                {/* 신호 사용자 판정(P2) — 날짜 전체 / 특정 구루 규칙(ruleId) */}
                <ReplayVerdictPanel
                  date={ctrl.selectedDate}
                  ruleOptions={ruleOptions}
                  ruleTitleById={ruleTitleById}
                  hasSignal={hasSignal}
                  tickerVerdicts={ctrl.tickerVerdicts}
                  onSet={(kind, memo, ruleId) => ctrl.selectedDate && ctrl.setVerdict(ctrl.selectedDate, kind, memo, ruleId)}
                  onClear={(date, ruleId) => ctrl.clearVerdict(date, ruleId)}
                  onJump={date => ctrl.selectDate(date)}
                />
              </div>
            </div>
          )}

          {/* 규칙별 성과 집계(③) — 이 기간 신호의 복기 결과(발화수·적중률·평균수익) */}
          <ReplayPerformancePanel performance={ctrl.performance} />

          {/* 손익비×승률 진단 — 내 판정(승/패)을 신호 후 수익률과 묶어 손익분기 대비 위치 표시 */}
          <ReplayWinRatePanel diag={ctrl.winRateDiagnostics} />

          {/* 규칙 샌드박스(P3) — leaf 값/on·off 즉석 조정 → 마커 즉시 재계산(라이브 미반영) */}
          <ReplaySandboxPanel
            rules={ctrl.sandboxRules}
            overrides={ctrl.sandboxOverrides}
            diff={ctrl.sandboxDiff}
            onSetValue={ctrl.sandboxSetValue}
            onSetBetween={ctrl.sandboxSetBetween}
            onSetEnabled={ctrl.sandboxSetEnabled}
            onResetLeaf={ctrl.sandboxResetLeaf}
            onResetRule={ctrl.sandboxResetRule}
            onResetAll={ctrl.sandboxResetAll}
          />
        </>
      )}

      {/* 검증 사례(P2) — 종목 미선택 상태에서도 저장 사례 재실행 가능하도록 항상 노출 */}
      <ReplayCasesPanel
        cases={ctrl.cases}
        currentTicker={ctrl.selected?.ticker ?? null}
        canSave={!!ctrl.timeline && ctrl.timeline.days.length > 0}
        onSave={(role, memo) => ctrl.saveCurrentCase(role, memo)}
        onLoad={c => ctrl.loadCase(c)}
        onDelete={id => ctrl.deleteCase(id)}
        comparingCase={ctrl.comparingCase}
        caseDiff={ctrl.caseDiff}
        onEndComparison={ctrl.endComparison}
      />

      {/* 놓친 매수/매도 모아보기(④) — 전 종목 누적, 종목 미선택 상태에서도 노출 */}
      <ReplayMissedPanel
        missed={ctrl.missedVerdicts}
        currentTicker={ctrl.selected?.ticker ?? null}
        resolvable={isResolvable}
        onJump={onJumpMissed}
      />

      {/* 검증 기록 백업(⑤) — JSON 내보내기/가져오기(localStorage 유실 대비) */}
      <div className="bg-gray-800 rounded-lg p-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-gray-400">💾 검증 기록 백업 <span className="text-gray-600">— 판정·사례 JSON(브라우저 저장소 유실 대비)</span></span>
        <div className="flex-1" />
        {importMsg && <span className="text-[11px] text-emerald-400">{importMsg}</span>}
        <button onClick={ctrl.exportReplayRecords} className="text-[11px] px-2.5 py-1 rounded bg-gray-900 text-gray-300 hover:bg-gray-700">내보내기</button>
        <label className="text-[11px] px-2.5 py-1 rounded bg-gray-900 text-gray-300 hover:bg-gray-700 cursor-pointer">
          가져오기
          <input type="file" accept="application/json,.json" className="hidden" onChange={handleImport} />
        </label>
      </div>

      <p className="text-[11px] text-gray-600 pt-2 border-t border-gray-700/60">
        지식 규칙 기반 참고 신호이며 투자자문이 아닙니다. 미검증·미구현 지표 규칙은 자동 발화되지 않습니다.
      </p>
    </div>
  );
};

export default SignalReplayView;
