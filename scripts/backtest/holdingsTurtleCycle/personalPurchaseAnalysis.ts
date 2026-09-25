// scripts/backtest/holdingsTurtleCycle/personalPurchaseAnalysis.ts
// CLI — §재검증 과제5: "산 날부터 터틀이었다면 vs 그대로 보유"를 사용자의 실제 매수일 기준으로 계산.
// **개인정보(실제 매수일·가격·종목 식별)를 다루므로 산출물은 DB/holdingsTurtleCycle/(로컬, gitignore)에만
// 남긴다 — 절대 docs/에 쓰지 않는다.**
//
// 입력: 보유 CSV(83종 유니버스) + 앱 내보내기 JSON(자산별 purchaseDate/purchasePrice, LZ압축 아님).
// 여러 번 나눠 산 종목(JSON에 동일 티커 복수 행)은 각 매수 시점을 개별 계산 후 수량가중 평균으로 합산하고
// 한계로 명시한다. JSON에 없거나 purchaseDate가 없는 종목은 "정보없음"으로 남기고 조용히 빼지 않는다.
//
// 사용법: npx tsx scripts/backtest/holdingsTurtleCycle/personalPurchaseAnalysis.ts "<CSV 경로>" "<앱 JSON 경로>"

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadHoldingsCsv, dedupeByTicker } from './csvHoldings';
import { resolveSymbol } from './symbolResolve';
import { readCache, buildSecurity, SecurityData } from './data';
import { simulateCell, isSkip, VariantRules } from './engine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', '..', '..', 'DB', 'holdingsTurtleCycle');

const V1: VariantRules = { id: 'V1', name: '표준(20/55)', entryLookback: 55, exitLookback: 20, atrPeriod: 20, stopMultipleN: 2 };
const COST_MULT = 1;
// 현금이자 0%/2.5% 두 시나리오 — 아래 r0/r25로 직접 계산(§규약 "현금 0%/2.5% 두 가지 보고").

interface AppAsset {
  ticker?: unknown;
  purchaseDate?: unknown;
  purchasePrice?: unknown;
  quantity?: unknown;
}
interface AppExport { assets?: unknown }

function isStr(v: unknown): v is string { return typeof v === 'string' && v.length > 0; }
function isNumV(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }

function loadAppAssets(jsonPath: string): { ticker: string; purchaseDate: string; purchasePrice: number; quantity: number }[] {
  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8')) as AppExport;
  if (!Array.isArray(raw.assets)) throw new Error('JSON 구조가 예상과 다릅니다 — assets 배열이 없습니다.');
  const out: { ticker: string; purchaseDate: string; purchasePrice: number; quantity: number }[] = [];
  for (const a of raw.assets as AppAsset[]) {
    if (!isStr(a.ticker) || !isStr(a.purchaseDate) || !isNumV(a.purchasePrice)) continue;
    out.push({ ticker: a.ticker, purchaseDate: a.purchaseDate, purchasePrice: a.purchasePrice, quantity: isNumV(a.quantity) ? a.quantity : 1 });
  }
  return out;
}

interface LotResult {
  purchaseDate: string; resolvedStartDate: string | null;
  bhFinalRatio: number | null; turtleFinalRatio: number | null; finalRatioRatio: number | null; turtleBeatsBh: boolean | null;
  quantity: number; skipReason: string | null;
}

interface TickerResult {
  ticker: string; name: string; assetClass: string;
  lots: LotResult[];
  // 수량가중 평균(유효 lot만). lot 1개면 그 값과 동일.
  weightedFinalRatioRatioCash0: number | null;
  weightedFinalRatioRatioCash25: number | null;
  status: 'ok' | 'no-purchase-info' | 'no-price-data';
}

function resolveStartIdx(sec: SecurityData, purchaseDateISO: string): number | null {
  for (let i = 0; i < sec.ownDates.length; i++) if (sec.ownDates[i] >= purchaseDateISO) return i;
  return null;
}

function main(): void {
  const csvPath = process.argv[2];
  const jsonPath = process.argv[3];
  if (!csvPath || !jsonPath) {
    console.error('사용법: npx tsx scripts/backtest/holdingsTurtleCycle/personalPurchaseAnalysis.ts "<CSV 경로>" "<앱 JSON 경로>"');
    process.exit(1);
  }

  const rows = loadHoldingsCsv(csvPath);
  const unique = dedupeByTicker(rows);
  const appAssets = loadAppAssets(jsonPath);
  console.log(`보유 CSV 고유 티커 ${unique.length}종, 앱 내보내기 자산 ${appAssets.length}건(매수일·가격 확보분)`);

  const appByTicker = new Map<string, typeof appAssets>();
  for (const a of appAssets) {
    const arr = appByTicker.get(a.ticker);
    if (arr) arr.push(a); else appByTicker.set(a.ticker, [a]);
  }

  const results: TickerResult[] = [];
  let matchedTickers = 0, multiLotTickers = 0, noInfoTickers = 0, noPriceDataTickers = 0;

  for (const u of unique) {
    const lotsRaw = appByTicker.get(u.ticker) ?? [];
    if (lotsRaw.length === 0) {
      results.push({ ticker: u.ticker, name: u.name, assetClass: u.assetClass, lots: [], weightedFinalRatioRatioCash0: null, weightedFinalRatioRatioCash25: null, status: 'no-purchase-info' });
      noInfoTickers++;
      continue;
    }
    if (lotsRaw.length > 1) multiLotTickers++;
    matchedTickers++;

    const r = resolveSymbol({ ticker: u.ticker, exchange: u.exchange, name: u.name });
    const raw = readCache(r.fetchSymbol);
    if (!raw) {
      results.push({ ticker: u.ticker, name: u.name, assetClass: u.assetClass, lots: [], weightedFinalRatioRatioCash0: null, weightedFinalRatioRatioCash25: null, status: 'no-price-data' });
      noPriceDataTickers++;
      continue;
    }
    const sec = buildSecurity({
      ticker: u.ticker, name: u.name, assetClass: u.assetClass, currency: r.currency, isCryptoTicker: r.isCryptoTicker, isKrEtf: r.isKrEtf,
      raw, atrPeriod: 20, lookbacks: [20, 55],
    });

    const lots: LotResult[] = [];
    let sumWeightCash0 = 0, sumWeightedRatioCash0 = 0;
    let sumWeightCash25 = 0, sumWeightedRatioCash25 = 0;
    for (const lot of lotsRaw) {
      const startIdx = resolveStartIdx(sec, lot.purchaseDate);
      if (startIdx === null) {
        lots.push({ purchaseDate: lot.purchaseDate, resolvedStartDate: null, bhFinalRatio: null, turtleFinalRatio: null, finalRatioRatio: null, turtleBeatsBh: null, quantity: lot.quantity, skipReason: '매수일 이후 가격 데이터 없음' });
        continue;
      }
      const r0 = simulateCell(sec, startIdx, V1, COST_MULT, { cashAnnualRatePct: 0 });
      const r25 = simulateCell(sec, startIdx, V1, COST_MULT, { cashAnnualRatePct: 2.5 });
      if (isSkip(r0) || isSkip(r25)) {
        lots.push({ purchaseDate: lot.purchaseDate, resolvedStartDate: sec.ownDates[startIdx], bhFinalRatio: null, turtleFinalRatio: null, finalRatioRatio: null, turtleBeatsBh: null, quantity: lot.quantity, skipReason: '워밍업 미충족(매수일이 상장 초기 등)' });
        continue;
      }
      lots.push({
        purchaseDate: lot.purchaseDate, resolvedStartDate: sec.ownDates[startIdx],
        bhFinalRatio: r0.bhFinalRatio, turtleFinalRatio: r0.turtleFinalRatio, finalRatioRatio: r0.finalRatioRatio, turtleBeatsBh: r0.turtleBeatsBh,
        quantity: lot.quantity, skipReason: null,
      });
      sumWeightCash0 += lot.quantity; sumWeightedRatioCash0 += lot.quantity * r0.finalRatioRatio;
      sumWeightCash25 += lot.quantity; sumWeightedRatioCash25 += lot.quantity * r25.finalRatioRatio;
    }

    results.push({
      ticker: u.ticker, name: u.name, assetClass: u.assetClass, lots,
      weightedFinalRatioRatioCash0: sumWeightCash0 > 0 ? sumWeightedRatioCash0 / sumWeightCash0 : null,
      weightedFinalRatioRatioCash25: sumWeightCash25 > 0 ? sumWeightedRatioCash25 / sumWeightCash25 : null,
      status: 'ok',
    });
  }

  console.log(`\n매칭 ${matchedTickers}/${unique.length}종 (그중 여러 lot ${multiLotTickers}종) · 매수정보 없음 ${noInfoTickers}종 · 가격데이터 없음 ${noPriceDataTickers}종`);

  const valid = results.filter(r => r.weightedFinalRatioRatioCash0 !== null);
  const ratios0 = valid.map(r => r.weightedFinalRatioRatioCash0 as number).sort((a, b) => a - b);
  const median0 = ratios0.length ? ratios0[Math.floor(ratios0.length / 2)] : null;
  const winRate0 = valid.length ? valid.filter(r => (r.weightedFinalRatioRatioCash0 as number) > 1).length / valid.length : null;
  console.log(`유효 티커 ${valid.length}종 — 최종가치비율(터틀/B&H, 현금0%) 중앙값=${median0?.toFixed(3)} 터틀승률=${winRate0 !== null ? (winRate0 * 100).toFixed(1) + '%' : 'N/A'}`);

  // ── 로컬 산출물 (개인정보 포함, docs에 절대 쓰지 않음) ──
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(path.join(DB_DIR, 'personalPurchaseAnalysis.json'), JSON.stringify({ generatedAt: new Date().toISOString(), csvPath, jsonPath, results }, null, 2));

  const md: string[] = [];
  md.push('# 실제 매수 시점 기준 결과 (로컬 전용, 개인정보 포함 — 절대 커밋 금지)\n');
  md.push(`생성: ${new Date().toISOString()}\n`);
  md.push(`매칭 ${matchedTickers}/${unique.length}종(여러 lot ${multiLotTickers}종) · 매수정보 없음 ${noInfoTickers}종 · 가격데이터 없음 ${noPriceDataTickers}종\n`);
  md.push(`유효 티커 ${valid.length}종 기준 최종가치비율(터틀/B&H, 현금이자0%) 중앙값 ${median0?.toFixed(3) ?? 'N/A'}, 터틀승률 ${winRate0 !== null ? (winRate0 * 100).toFixed(1) + '%' : 'N/A'}\n`);
  md.push('형식: `티커 (종목명) [자산구분] — 매수일 → 최종가치비율(현금0%/2.5%) [터틀승/B&H승]`\n');
  for (const r of results) {
    if (r.status === 'no-purchase-info') { md.push(`- ${r.ticker} (${r.name}) [${r.assetClass}] — 매수정보 없음(앱 JSON에 해당 티커 없음)`); continue; }
    if (r.status === 'no-price-data') { md.push(`- ${r.ticker} (${r.name}) [${r.assetClass}] — 가격 데이터 없음`); continue; }
    const lotStr = r.lots.map(l => {
      if (l.finalRatioRatio === null) return `${l.purchaseDate}(${l.skipReason})`;
      return `${l.purchaseDate}→${l.resolvedStartDate}(수량${l.quantity}) 비율=${l.finalRatioRatio.toFixed(3)} ${l.turtleBeatsBh ? '터틀승' : 'B&H승'}`;
    }).join(' / ');
    const w0 = r.weightedFinalRatioRatioCash0, w25 = r.weightedFinalRatioRatioCash25;
    md.push(`- ${r.ticker} (${r.name}) [${r.assetClass}] — ${lotStr} || 수량가중 비율: 현금0%=${w0?.toFixed(3) ?? 'N/A'} 현금2.5%=${w25?.toFixed(3) ?? 'N/A'}`);
  }
  writeFileSync(path.join(DB_DIR, '매수시점기준_결과.md'), md.join('\n') + '\n');
  console.log(`\n로컬 기록(개인정보, 절대 커밋 금지): DB/holdingsTurtleCycle/매수시점기준_결과.md, personalPurchaseAnalysis.json`);
}

main();
