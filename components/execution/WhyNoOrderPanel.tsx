// components/execution/WhyNoOrderPanel.tsx
// ---------------------------------------------------------------------------
// "왜 주문이 없나요?" 진단 패널 (Phase 2b-6, 렌더 전용).
// refreshActionQueue가 0건일 때 사유를 사람이 읽는 문장으로 보여준다.
//
// 톤 규칙(Codex): 조치 가능한 사유(예산 0·후보 없음·시세 미갱신·데이터 부족)는 강조(action),
//   55일 미돌파 등 정상 상태는 중립(neutral). 후보는 상위 몇 개만(장황 금지).

import React, { useState } from 'react';
import { RefreshDiagnostics, TurtleEntryDiagReason, TurtleEntryDiag } from '../../types/actionQueue';

interface Props {
  diagnostics: RefreshDiagnostics;
}

const MAX_TICKERS = 4;

const tickersOf = (list: TurtleEntryDiag[], reason: TurtleEntryDiagReason): string[] =>
  list.filter(c => c.reason === reason).map(c => c.ticker);

const joinTickers = (tickers: string[]): string => {
  if (tickers.length <= MAX_TICKERS) return tickers.join(', ');
  return `${tickers.slice(0, MAX_TICKERS).join(', ')} 외 ${tickers.length - MAX_TICKERS}개`;
};

interface Row { key: string; tone: 'action' | 'neutral'; text: string; }

function buildRows(d: RefreshDiagnostics): Row[] {
  const rows: Row[] = [];
  const cands = d.actions.candidates;

  // ── 조치 가능(action) ──
  if (d.budgetMissing) {
    rows.push({ key: 'budget', tone: 'action', text: '위성 예산이 0입니다 — 위 예산 칸에 금액을 입력하면 신규 매수 주문이 생성됩니다.' });
  }
  if (d.turtleCandidateCount === 0) {
    rows.push({ key: 'no-candidate', tone: 'action', text: '터틀 후보 종목이 없습니다 — 관심종목에서 🐢 터틀 후보로 지정하세요.' });
  }
  if (d.stalePriceTickers.length > 0) {
    rows.push({ key: 'stale', tone: 'action', text: `시세 미갱신으로 건너뜀: ${joinTickers(d.stalePriceTickers)} — 관심종목 시세를 갱신하세요.` });
  }
  const noData = [...tickersOf(cands, 'no-market'), ...tickersOf(cands, 'no-n')];
  if (noData.length > 0) {
    rows.push({ key: 'no-data', tone: 'action', text: `가격 데이터(OHLCV)·N 부족으로 판정 불가: ${joinTickers(noData)}` });
  }
  const posNoMarket = d.actions.positions.filter(p => p.reason === 'no-market').map(p => p.ticker);
  if (posNoMarket.length > 0) {
    rows.push({ key: 'pos-no-market', tone: 'action', text: `보유 포지션 시세 데이터 없음: ${joinTickers(posNoMarket)} — 가격 업데이트 필요.` });
  }

  // ── 정상/조건(neutral) ──
  const noBreak = tickersOf(cands, 'no-breakout');
  if (noBreak.length > 0) {
    rows.push({ key: 'no-breakout', tone: 'neutral', text: `55일 신고가 미돌파(정상 대기): ${joinTickers(noBreak)}` });
  }
  const riskLimit = tickersOf(cands, 'risk-limit');
  if (riskLimit.length > 0) {
    rows.push({ key: 'risk-limit', tone: 'neutral', text: `동시 리스크 한도(12%) 초과로 보류: ${joinTickers(riskLimit)}` });
  }
  const insufficient = tickersOf(cands, 'insufficient-budget');
  if (insufficient.length > 0) {
    rows.push({ key: 'insufficient', tone: 'neutral', text: `예산 잔여 부족으로 보류: ${joinTickers(insufficient)}` });
  }
  const zeroQty = tickersOf(cands, 'zero-qty');
  if (zeroQty.length > 0) {
    rows.push({ key: 'zero-qty', tone: 'neutral', text: `사이징 0주(예산 대비 변동성 과대): ${joinTickers(zeroQty)}` });
  }
  const dupCand = tickersOf(cands, 'duplicate-pending');
  const dupPos = d.actions.positions.filter(p => p.reason === 'duplicate-pending').map(p => p.ticker);
  const dup = [...dupCand, ...dupPos];
  if (dup.length > 0) {
    rows.push({ key: 'dup', tone: 'neutral', text: `이미 대기 중인 주문이 있어 재생성 안 함: ${joinTickers(dup)}` });
  }
  const noTrigger = d.actions.positions.filter(p => p.reason === 'no-trigger').length;
  if (noTrigger > 0) {
    rows.push({ key: 'no-trigger', tone: 'neutral', text: `보유 포지션 ${noTrigger}개는 손절/청산/불타기 조건 미충족(정상 대기).` });
  }

  return rows;
}

const WhyNoOrderPanel: React.FC<Props> = ({ diagnostics }) => {
  const [open, setOpen] = useState(true);
  const rows = buildRows(diagnostics);
  if (rows.length === 0) return null;

  return (
    <div className="mb-3 rounded-md border border-gray-700 bg-gray-800/60">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="text-xs sm:text-sm font-medium text-gray-200">왜 주문이 없나요?</span>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="px-3 pb-3 space-y-1.5">
          {rows.map(r => (
            <li key={r.key} className="flex items-start gap-2 text-xs">
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.tone === 'action' ? 'bg-amber-400' : 'bg-gray-500'}`} />
              <span className={r.tone === 'action' ? 'text-amber-200' : 'text-gray-400'}>{r.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default WhyNoOrderPanel;
