// components/dashboard/TodayTurtleCard.tsx
// ---------------------------------------------------------------------------
// "오늘의 터틀 확인" — 읽기 전용 카드 (렌더 전용).
// 주문·저장 버튼 없음. 계산은 utils/todayTurtle, 데이터는 hooks/useTodayTurtle.
// 데스크톱·모바일이 **같은 화면 모델**을 쓴다(별도 계산 없음).
// 색상만으로 상태를 구분하지 않고 상태명을 글자로 표시한다.

import React, { useMemo, useState } from 'react';
import { useTodayTurtle } from '../../hooks/useTodayTurtle';
import { TodayRow, WatchRow, PositionRow, LegacySatelliteRow } from '../../types/todayTurtle';
import { isWaitingRow } from '../../utils/todayTurtle';
import { TURTLE_LOCK_BADGE, TURTLE_LOCK_MESSAGE, isTurtleOrderLocked } from '../../types/turtleLock';

const HELP_TEXT =
  '55/20 규칙은 19개 대표자산을 묶은 탐색적 백테스트에서 확인됐으며 개별 종목 성과를 보장하지 않습니다.';

function fmt(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** 상태명(글자) + 쉬운 이유 한 문장. */
function describe(row: TodayRow): { label: string; tone: string; reason: string } {
  if (row.kind === 'position') {
    const r = row as PositionRow;
    switch (r.status) {
      case 'sell-check-stop':
        return { label: '오늘 매도 확인 — 손절선 아래', tone: 'text-red-300 border-red-500/40 bg-red-500/10',
          reason: `살 때 정해둔 손절가 ${fmt(r.stopPrice)} 아래로 종가가 내려왔습니다.` };
      case 'sell-check-exit':
        return { label: '오늘 매도 확인 — 20일 청산선 도달', tone: 'text-orange-300 border-orange-500/40 bg-orange-500/10',
          reason: `종가가 직전 20일 최저가 ${fmt(r.exitLine)} 이하입니다.` };
      case 'waiting-exit-unknown':
        return { label: '손절선 위 · 20일선 확인 불가', tone: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
          reason: `손절선 ${fmt(r.stopPrice)}은 넘지 않았지만, 20일 계산에 필요한 자료가 부족합니다.` };
      case 'stop-record-error':
        return { label: '손절선 기록 오류 — 확인 필요', tone: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
          reason: '저장된 손절가가 올바르지 않습니다. 임의로 고쳐 쓰지 않고 그대로 알려 드립니다. 실행 탭에서 포지션 기록을 확인하세요.' };
      case 'link-error':
        return { label: '포지션 연결 확인 필요', tone: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
          reason: '터틀 포지션이 어느 보유 자산과 연결되는지 확정할 수 없습니다(연결 정보 없음 또는 같은 티커 후보가 여러 개). 임의로 고르지 않았습니다.' };
      case 'waiting':
        return { label: '기다림', tone: 'text-gray-300 border-gray-600 bg-gray-700/30',
          reason: `손절선 ${fmt(r.stopPrice)}, 20일 청산선 ${fmt(r.exitLine)} 어디에도 닿지 않았습니다.` };
      default:
        return { label: '확인 불가', tone: 'text-gray-400 border-gray-600 bg-gray-700/30', reason: dataReason(row) };
    }
  }
  if (row.kind === 'legacy') {
    const r = row as LegacySatelliteRow;
    switch (r.status) {
      case 'exit-line-touched':
        return { label: '20일 청산선 도달 — 참고', tone: 'text-yellow-300 border-yellow-500/40 bg-yellow-500/10',
          reason: `종가가 직전 20일 최저가 ${fmt(r.exitLine)} 이하입니다. 기존 보유분에 대한 가격위험 점검 참고이며 자동 매도 신호가 아닙니다.` };
      case 'above-exit-line':
        return { label: '청산선 위 — 기다림', tone: 'text-gray-300 border-gray-600 bg-gray-700/30',
          reason: `직전 20일 최저가 ${fmt(r.exitLine)}보다 위에 있습니다.` };
      default:
        return { label: '확인 불가', tone: 'text-gray-400 border-gray-600 bg-gray-700/30', reason: dataReason(row) };
    }
  }
  const r = row as WatchRow;
  switch (r.status) {
    case 'breakout-confirmed':
      return { label: '55일 돌파 확인', tone: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
        reason: `종가가 직전 55일 최고가 ${fmt(r.breakoutLine)} 이상입니다. 관찰용 매수 검토 후보입니다.` };
    case 'waiting':
      return { label: r.intradayAboveLine ? '장중 돌파 중 — 종가 확인 전' : '기다림',
        tone: r.intradayAboveLine ? 'text-sky-300 border-sky-500/40 bg-sky-500/10' : 'text-gray-300 border-gray-600 bg-gray-700/30',
        reason: r.intradayAboveLine
          ? `장중 ${fmt(r.intradayPrice)}가 돌파선 ${fmt(r.breakoutLine)}를 넘었지만 종가로 확정되지 않았습니다.`
          : `돌파선 ${fmt(r.breakoutLine)}까지 ${r.gapToLinePct != null ? r.gapToLinePct.toFixed(1) : '—'}% 남았습니다.` };
    default:
      return { label: '확인 불가', tone: 'text-gray-400 border-gray-600 bg-gray-700/30', reason: dataReason(row) };
  }
}

function dataReason(row: TodayRow): string {
  const q = row.quality;
  if (q.issues.includes('fetch-failed')) return '시세를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.';
  if (q.issues.includes('no-high-low')) return '고가·저가 자료를 받지 못해 계산하지 않았습니다.';
  if (q.issues.includes('no-completed-bar')) return '완료된 일봉이 아직 없습니다.';
  if (q.issues.includes('insufficient-bars')) {
    const need = row.kind === 'watch' ? 56 : 21;
    return `일봉이 부족합니다 (필요 ${need}개, 현재 ${q.validCompletedBars}개).`;
  }
  return '판정에 필요한 자료가 부족합니다.';
}

const TZ_LABEL: Record<string, string> = { KR: '한국', US: '미국', CRYPTO: '코인', UNKNOWN: '기준 미상' };

const Row: React.FC<{ row: TodayRow }> = ({ row }) => {
  const d = describe(row);
  const isLink = row.kind === 'position' && row.status === 'link-error';
  const line = row.kind === 'watch'
    ? { name: '55일 돌파선', v: (row as WatchRow).breakoutLine }
    : { name: '20일 청산선', v: (row as PositionRow | LegacySatelliteRow).exitLine };
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white text-sm">{row.name}</span>
        <span className="text-[11px] text-gray-500">{row.ticker}</span>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${d.tone}`}>{d.label}</span>
      </div>
      <p className="mt-1.5 text-xs text-gray-300 leading-relaxed">{d.reason}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div className="flex justify-between"><dt className="text-gray-500">완료종가</dt><dd className="text-gray-200 tabular-nums">{fmt(row.completedClose)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">{line.name}</dt><dd className="text-gray-200 tabular-nums">{fmt(line.v)}</dd></div>
        {row.kind === 'position' && (
          <div className="flex justify-between">
            <dt className="text-gray-500">손절선</dt>
            <dd className={(row as PositionRow).stopPrice == null ? 'text-amber-300' : 'text-gray-200 tabular-nums'}>
              {(row as PositionRow).stopPrice == null ? '기록 오류' : fmt((row as PositionRow).stopPrice)}
            </dd>
          </div>
        )}
        {row.kind === 'legacy' && (
          <div className="flex justify-between"><dt className="text-gray-500">손절가</dt><dd className="text-gray-500">기록 없음 — 계산하지 않음</dd></div>
        )}
      </dl>
      <p className="mt-1.5 text-[10px] text-gray-500">
        {row.quality.asOfDate ? `${row.quality.asOfDate} 종가 기준` : '판정 기준일 없음'}
        {!isLink && ` · ${TZ_LABEL[row.quality.marketTz]}`}
        {row.quality.conservativeDrop ? ' · 최신 봉은 보수적으로 제외' : ''}
        {row.quality.droppedRows > 0 ? ` · 비정상 ${row.quality.droppedRows}행 제외` : ''}
      </p>
    </div>
  );
};

const TodayTurtleCard: React.FC = () => {
  const model = useTodayTurtle();
  const [showWaiting, setShowWaiting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const { actionRows, waitingRows } = useMemo(() => ({
    actionRows: model.rows.filter(r => !isWaitingRow(r)),
    waitingRows: model.rows.filter(r => isWaitingRow(r)),
  }), [model.rows]);

  const s = model.summary;

  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold text-white">🐢 오늘의 터틀 확인</h3>
          <button
            type="button"
            onClick={() => setShowHelp(v => !v)}
            className="text-[11px] text-gray-400 hover:text-gray-200 underline"
            aria-expanded={showHelp}
          >
            도움말
          </button>
        </div>
        {isTurtleOrderLocked() && (
          <span className="text-[11px] px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300">
            {TURTLE_LOCK_BADGE}
          </span>
        )}
      </div>

      {showHelp && (
        <p className="mt-2 text-[11px] text-gray-400 leading-relaxed bg-gray-900/40 rounded p-2">
          {HELP_TEXT}
          <br />
          {TURTLE_LOCK_MESSAGE}
        </p>
      )}

      <p className="mt-2 text-xs text-gray-400">
        오늘 매도 확인 {s.sellCheck} · 55일 돌파 확인 {s.breakout} · 가격위험 참고 {s.legacyTouched} · 데이터 확인 {s.dataIssues}
        {s.intradayBreakout > 0 && ` · 장중 돌파 중 ${s.intradayBreakout}`}
      </p>

      {model.isLoading && <p className="mt-3 text-xs text-gray-500">시세를 불러오는 중입니다…</p>}
      {model.partialFailure && !model.isLoading && (
        <p className="mt-2 text-[11px] text-amber-300/80">일부 종목의 시세를 불러오지 못했습니다. 해당 종목은 «확인 불가»로 표시됩니다.</p>
      )}

      {!model.isLoading && actionRows.length === 0 && (
        <p className="mt-3 text-xs text-gray-400">오늘 확정된 55일 돌파 신호는 없습니다.</p>
      )}

      {actionRows.length > 0 && (
        <div className="mt-3 space-y-2">
          {actionRows.map(r => <Row key={`${r.kind}-${r.ticker}`} row={r} />)}
        </div>
      )}

      {waitingRows.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowWaiting(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-200"
            aria-expanded={showWaiting}
          >
            {showWaiting ? '▾' : '▸'} 기다림 {waitingRows.length}종목
          </button>
          {showWaiting && (
            <div className="mt-2 space-y-2">
              {waitingRows.map(r => <Row key={`${r.kind}-${r.ticker}`} row={r} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TodayTurtleCard;
