// components/dashboard/TodayTurtleCard.tsx
// ---------------------------------------------------------------------------
// "오늘의 터틀 확인" — 읽기 전용 카드 (렌더 전용).
// 주문·저장 버튼 없음. 계산은 utils/todayTurtle, 데이터는 hooks/useTodayTurtle.
// 데스크톱·모바일이 **같은 화면 모델**을 쓴다(별도 계산 없음).
// 색상만으로 상태를 구분하지 않고 상태명을 글자로 표시한다.
// Stage A(2026-09-14): 훅을 호출하지 않는 **뷰**로 전환 — `useTodayTurtle()`은 홈의
// `components/today/TodayActionCenter`가 한 번만 호출해 `model`을 내려준다(시세 조회 중복 방지).
// 접힘은 상위 WatchSection 한 단계만 담당한다(카드 자체 접힘 제거 — 2단 접힘 해소).

import React, { useMemo, useState } from 'react';
import { ChevronDown, OctagonAlert } from 'lucide-react';
import { TodayRow, TodayTurtleModel, WatchRow, PositionRow, LegacySatelliteRow } from '../../types/todayTurtle';
import { isWaitingRow } from '../../utils/todayTurtle';
import { TURTLE_LOCK_BADGE, TURTLE_LOCK_MESSAGE, isTurtleOrderLocked } from '../../types/turtleLock';

const HELP_TEXT =
  '55/20 규칙은 19개 대표자산을 묶은 탐색적 백테스트에서 확인됐으며 개별 종목 성과를 보장하지 않습니다.';

function fmt(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** 상태명(글자) + 쉬운 이유 한 문장. strong = 강한 위험(OctagonAlert + font-semibold + border-warning, §8 색 규약). */
function describe(row: TodayRow): { label: string; tone: string; reason: string; strong?: boolean } {
  if (row.kind === 'position') {
    const r = row as PositionRow;
    switch (r.status) {
      case 'sell-check-stop':
        return { label: '오늘 매도 확인 — 손절선 아래', tone: 'text-warning font-semibold border-warning bg-warning-soft', strong: true,
          reason: `살 때 정해둔 손절가 ${fmt(r.stopPrice)} 아래로 종가가 내려왔습니다.` };
      case 'sell-check-exit':
        return { label: '오늘 매도 확인 — 20일 청산선 도달', tone: 'text-warning border-warning/40 bg-warning-soft',
          reason: `종가가 직전 20일 최저가 ${fmt(r.exitLine)} 이하입니다.` };
      case 'waiting-exit-unknown':
        return { label: '손절선 위 · 20일선 확인 불가', tone: 'text-warning border-warning/40 bg-warning-soft',
          reason: `손절선 ${fmt(r.stopPrice)}은 넘지 않았지만, 20일 계산에 필요한 자료가 부족합니다.` };
      case 'stop-record-error':
        return { label: '손절선 기록 오류 — 확인 필요', tone: 'text-warning border-warning/40 bg-warning-soft',
          reason: '저장된 손절가가 올바르지 않습니다. 임의로 고쳐 쓰지 않고 그대로 알려 드립니다. 보유자산 표의 터틀 포지션 정보에서 확인하세요.' };
      case 'link-error':
        return { label: '포지션 연결 확인 필요', tone: 'text-warning border-warning/40 bg-warning-soft',
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
        return { label: '20일 청산선 도달 — 참고', tone: 'text-warning border-warning/30 bg-warning-soft',
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
      return { label: '55일 돌파 확인', tone: 'text-up border-up/40 bg-up-soft',
        reason: `종가가 직전 55일 최고가 ${fmt(r.breakoutLine)} 이상입니다. 관찰용 매수 검토 후보입니다.` };
    case 'waiting':
      return { label: r.intradayAboveLine ? '장중 돌파 중 — 종가 확인 전' : '기다림',
        tone: r.intradayAboveLine ? 'text-info border-info/30 bg-info-soft' : 'text-gray-300 border-gray-600 bg-gray-700/30',
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
    <div className="rounded-lg border border-border-subtle bg-surface-elevated p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white text-sm">{row.name}</span>
        <span className="text-xs text-gray-500">{row.ticker}</span>
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${d.tone}`}>
          {d.strong && <OctagonAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {d.label}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-gray-300 leading-relaxed">{d.reason}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div className="flex justify-between"><dt className="text-gray-500">완료종가</dt><dd className="text-gray-200 tabular-nums">{fmt(row.completedClose)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">{line.name}</dt><dd className="text-gray-200 tabular-nums">{fmt(line.v)}</dd></div>
        {row.kind === 'position' && (
          <div className="flex justify-between">
            <dt className="text-gray-500">손절선</dt>
            <dd className={(row as PositionRow).stopPrice == null ? 'text-warning' : 'text-gray-200 tabular-nums'}>
              {(row as PositionRow).stopPrice == null ? '기록 오류' : fmt((row as PositionRow).stopPrice)}
            </dd>
          </div>
        )}
        {row.kind === 'legacy' && (
          <div className="flex justify-between"><dt className="text-gray-500">손절가</dt><dd className="text-gray-500">기록 없음 — 계산하지 않음</dd></div>
        )}
      </dl>
      <p className="mt-1.5 text-xs text-gray-500">
        {row.quality.asOfDate ? `${row.quality.asOfDate} 종가 기준` : '판정 기준일 없음'}
        {!isLink && ` · ${TZ_LABEL[row.quality.marketTz]}`}
        {row.quality.conservativeDrop ? ' · 최신 봉은 보수적으로 제외' : ''}
        {row.quality.droppedRows > 0 ? ` · 비정상 ${row.quality.droppedRows}행 제외` : ''}
      </p>
    </div>
  );
};

export interface TodayTurtleCardProps {
  /** `hooks/useTodayTurtle()` 결과 — 호출부(TodayActionCenter)가 한 번만 조회해 주입 */
  model: TodayTurtleModel;
}

const TodayTurtleCard: React.FC<TodayTurtleCardProps> = ({ model }) => {
  const [showWaiting, setShowWaiting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const { actionRows, waitingRows } = useMemo(() => ({
    actionRows: model.rows.filter(r => !isWaitingRow(r)),
    waitingRows: model.rows.filter(r => isWaitingRow(r)),
  }), [model.rows]);

  const s = model.summary;

  return (
    <div className="rounded-card border border-border-subtle bg-surface-muted p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">오늘의 터틀 확인</h3>
          <button
            type="button"
            onClick={() => setShowHelp(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-200 underline"
            aria-expanded={showHelp}
          >
            도움말
          </button>
        </div>
        <div className="flex items-center gap-2">
          {isTurtleOrderLocked() && (
            <span className="text-xs px-2 py-0.5 rounded border border-warning/40 bg-warning-soft text-warning">
              {TURTLE_LOCK_BADGE}
            </span>
          )}
        </div>
      </div>

      {showHelp && (
        <p className="mt-2 text-xs text-gray-400 leading-relaxed bg-surface-elevated rounded p-2">
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
        <p className="mt-2 text-xs text-warning">일부 종목의 시세를 불러오지 못했습니다. 해당 종목은 «확인 불가»로 표시됩니다.</p>
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
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200"
            aria-expanded={showWaiting}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showWaiting ? '' : '-rotate-90'}`} aria-hidden="true" />
            기다림 {waitingRows.length}종목
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
