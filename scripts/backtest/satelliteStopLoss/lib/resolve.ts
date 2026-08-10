// scripts/backtest/satelliteStopLoss/lib/resolve.ts
// 티커 해석(프로브) 계층 — 연구 전용(앱/백엔드 무접촉).
//
// 국내 종목은 코스피(.KS)/코스닥(.KQ) 접미사가 달라 1순위 후보가 빗나갈 수 있다.
// 여기서는 universe 의 symbol → altSymbols 순으로 Yahoo v8 을 프로브해 **처음 성공한 티커**를
// 확정 티커로 채택하고, 전부 실패하면 실패 사유를 그대로 보존한다(조용히 제외하지 않는다).
//
// 데이터 계층은 coreStopLoss/lib/yahooData.ts 를 **그대로 재사용**한다(로직 복제 금지).
// 따라서 디스크 캐시도 scripts/backtest/coreStopLoss/cache/ 를 공유한다 — 캐시는 심볼+요청범위
// 단위이므로 폴더 공유로 인한 오염은 없다.

import { fetchAdjSeries, type AdjSeries } from '../../coreStopLoss/lib/yahooData';
import type { UniverseEntry } from './universe';

export interface ResolvedEntry {
  entry: UniverseEntry;
  /** 프로브 성공 티커. 전부 실패면 null. */
  resolvedSymbol: string | null;
  /** 실제로 시도한 티커 목록(순서대로). */
  triedSymbols: string[];
  /** 후보별 실패 사유(성공한 후보는 목록에 없음). */
  failures: Array<{ symbol: string; error: string }>;
  series: AdjSeries | null;
  ok: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 유니버스 전체의 티커를 순차 프로브해 확정한다.
 * @param entries 유니버스 항목
 * @param start   요청 시작일(YYYY-MM-DD)
 * @param end     요청 종료일(YYYY-MM-DD)
 */
export async function resolveUniverse(
  entries: UniverseEntry[],
  start: string,
  end: string
): Promise<ResolvedEntry[]> {
  const out: ResolvedEntry[] = [];
  let networkCount = 0;
  let cacheCount = 0;

  for (const entry of entries) {
    const candidates = [entry.symbol, ...(entry.altSymbols ?? [])];
    const tried: string[] = [];
    const failures: Array<{ symbol: string; error: string }> = [];
    let resolved: { symbol: string; series: AdjSeries } | null = null;

    for (const sym of candidates) {
      tried.push(sym);
      let didNetwork = false;
      const series = await fetchAdjSeries(sym, start, end, () => {
        didNetwork = true;
      });
      if (didNetwork) {
        networkCount += 1;
        await sleep(300); // 폴라이트 딜레이(캐시 히트엔 적용 안 됨)
      } else {
        cacheCount += 1;
      }

      if (series.ok && series.dates.length > 0) {
        resolved = { symbol: sym, series };
        break;
      }
      failures.push({ symbol: sym, error: series.error ?? 'no-data' });
    }

    if (resolved) {
      const s = resolved.series;
      console.log(
        `  ✓ ${resolved.symbol.padEnd(11)} ${entry.name}` +
          `  ${s.dates.length}일, ${s.dates[0]}~${s.dates[s.dates.length - 1]}` +
          (resolved.symbol !== entry.symbol ? `  [대체 티커 채택: 1순위 ${entry.symbol} 실패]` : '')
      );
      out.push({
        entry,
        resolvedSymbol: resolved.symbol,
        triedSymbols: tried,
        failures,
        series: s,
        ok: true,
      });
    } else {
      console.log(
        `  ✗ ${entry.symbol.padEnd(11)} ${entry.name}  — 전 후보 실패: ` +
          failures.map(f => `${f.symbol}(${f.error})`).join(', ')
      );
      out.push({
        entry,
        resolvedSymbol: null,
        triedSymbols: tried,
        failures,
        series: null,
        ok: false,
      });
    }
  }

  console.log(`  (네트워크 조회 ${networkCount}건 / 캐시 히트 ${cacheCount}건)`);
  return out;
}
