// scripts/backtest/holdingsTurtleCycle/csvHoldings.ts
// 보유자산 CSV 파서 — 순수 파서(parseHoldingsCsvText) + 파일 로더(loadHoldingsCsv) 분리.
// 개인정보(실제 티커·금액)는 이 파일에 담지 않는다 — 호출부가 로컬 CSV 경로를 인자로 넘긴다.
// 헤더 열 순서가 바뀌면 조용히 오독하지 않고 throw한다(fail-closed).

import { readFileSync } from 'fs';

export interface HoldingRow {
  name: string;
  ticker: string;
  exchange: string;
  assetClass: string;
  quantity: number;
  buyPriceLocal: number | null;
  buyFxRate: number | null;
  buyAmountKRW: number | null;
  currentPriceKRW: number | null;
  currentValueKRW: number | null;
  pnlKRW: number | null;
  returnPct: number | null;
}

const EXPECTED_HEADER = [
  '종목명', '티커', '거래소', '자산구분', '보유수량', '매수단가(자국통화)', '매수환율',
  '총매수금액(원화)', '현재단가(원화)', '현재평가금액(원화)', '총손익(원화)', '수익률(%)',
];

function parseNum(s: string | undefined): number | null {
  const t = (s ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 순수 파서 — CSV 텍스트(BOM 포함 가능) → 보유행 배열. 필드에 콤마가 없는 형식(실측 확인됨)이라 단순 split. */
export function parseHoldingsCsvText(raw: string): HoldingRow[] {
  const text = raw.length > 0 && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = lines[0].split(',').map(s => s.trim());
  for (let i = 0; i < EXPECTED_HEADER.length; i++) {
    if (header[i] !== EXPECTED_HEADER[i]) {
      throw new Error(
        `CSV 헤더 불일치 — 열 ${i}: 기대="${EXPECTED_HEADER[i]}" 실제="${header[i] ?? '(없음)'}" — 형식이 바뀌었을 수 있습니다.`
      );
    }
  }

  const rows: HoldingRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = lines[li].split(',');
    if (cols.length < EXPECTED_HEADER.length) {
      throw new Error(`CSV ${li + 1}행 열 수 부족(${cols.length}/${EXPECTED_HEADER.length}): "${lines[li]}"`);
    }
    rows.push({
      name: cols[0].trim(),
      ticker: cols[1].trim(),
      exchange: cols[2].trim(),
      assetClass: cols[3].trim(),
      quantity: parseNum(cols[4]) ?? 0,
      buyPriceLocal: parseNum(cols[5]),
      buyFxRate: parseNum(cols[6]),
      buyAmountKRW: parseNum(cols[7]),
      currentPriceKRW: parseNum(cols[8]),
      currentValueKRW: parseNum(cols[9]),
      pnlKRW: parseNum(cols[10]),
      returnPct: parseNum(cols[11]),
    });
  }
  return rows;
}

export function loadHoldingsCsv(csvPath: string): HoldingRow[] {
  return parseHoldingsCsvText(readFileSync(csvPath, 'utf-8'));
}

export interface UniqueHolding {
  ticker: string;
  name: string;
  exchange: string;
  assetClass: string;
  totalQuantity: number;
  totalCurrentValueKRW: number;
  totalPnlKRW: number;
  /** 중복 합산 후 재계산한 현재 수익률(%) = 총손익 ÷ 총매수금액. 매수금액 미확보 시 null. */
  currentReturnPct: number | null;
  rowCount: number;
}

/**
 * 동일 티커 중복(계좌·소유자별로 분리 기록된 행, 예: BMNR)을 합산해 고유 티커 목록으로 만든다.
 * "고유 티커 전부 사용" 요구사항 — 합산 후 종목당 1행.
 */
export function dedupeByTicker(rows: HoldingRow[]): UniqueHolding[] {
  interface Acc extends UniqueHolding { totalBuyAmountKRW: number }
  const map = new Map<string, Acc>();
  for (const r of rows) {
    const cur = map.get(r.ticker);
    if (!cur) {
      map.set(r.ticker, {
        ticker: r.ticker,
        name: r.name,
        exchange: r.exchange,
        assetClass: r.assetClass,
        totalQuantity: r.quantity,
        totalCurrentValueKRW: r.currentValueKRW ?? 0,
        totalPnlKRW: r.pnlKRW ?? 0,
        totalBuyAmountKRW: r.buyAmountKRW ?? 0,
        currentReturnPct: null,
        rowCount: 1,
      });
    } else {
      cur.totalQuantity += r.quantity;
      cur.totalCurrentValueKRW += r.currentValueKRW ?? 0;
      cur.totalPnlKRW += r.pnlKRW ?? 0;
      cur.totalBuyAmountKRW += r.buyAmountKRW ?? 0;
      cur.rowCount++;
    }
  }
  return Array.from(map.values()).map(v => ({
    ticker: v.ticker,
    name: v.name,
    exchange: v.exchange,
    assetClass: v.assetClass,
    totalQuantity: v.totalQuantity,
    totalCurrentValueKRW: v.totalCurrentValueKRW,
    totalPnlKRW: v.totalPnlKRW,
    currentReturnPct: v.totalBuyAmountKRW > 0 ? (v.totalPnlKRW / v.totalBuyAmountKRW) * 100 : null,
    rowCount: v.rowCount,
  }));
}
