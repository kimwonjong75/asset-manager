// scripts/backtest/usRoughCheck/universe.ts
// ---------------------------------------------------------------------------
// 미국 약식 사전점검 — S&P500 **현재** 구성종목 티커 확보(무료 스크래핑).
//
// ⚠⚠ 생존편향의 근원 ⚠⚠
// 여기서 얻는 리스트는 **오늘(스크래핑 시점) S&P500에 남아 있는 종목**이다.
// 2010~2022 구간 분석에 이 리스트를 그대로 쓰면:
//   1. 그 사이 파산·상장폐지된 종목이 표본에서 통째로 빠진다(최악 경로 소실).
//   2. 인수합병으로 사라진 종목도 빠진다.
//   3. 나중에 S&P500에 **편입된** 종목은 편입 전(무명 소형주 시절) 성과까지 표본에 들어온다
//      — 편입 자체가 "그때부터 크게 성장했다"는 사후 정보이므로 과거 성과가 미화된다.
// 따라서 이 디렉토리의 모든 결과는 **약식 사전점검(rough pre-check)** 이며,
// 채택 근거로 쓰면 안 된다. 정밀검증에는 상장폐지 포함 유료 데이터가 필요하다
// (`docs/backtest/RESEARCH_미국데이터소스_조사.md` 참조).
//
// 출처: https://en.wikipedia.org/wiki/List_of_S%26P_500_companies (id="constituents" 테이블)
// 스크래핑 결과는 `cache/universe_sp500.json` 에 스냅샷 저장(재현성).
//
// 규칙: `any` 금지(파싱 경계 최소 예외), `console.*` 금지(런너 제외), `Math.random` 금지.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CACHE_DIR = path.join(__dirname, 'cache');
const UNIVERSE_FILE = path.join(CACHE_DIR, 'universe_sp500.json');
const SCHEMA_VERSION = 1 as const;

export const WIKIPEDIA_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';

export interface UniverseSnapshot {
  schemaVersion: 1;
  source: string;
  fetchedAt: string;
  /** Yahoo 조회용으로 정규화된 티커(BRK.B → BRK-B). */
  symbols: string[];
  /** 위키백과 원문 티커(정규화 전). symbols와 index 정렬. */
  rawSymbols: string[];
}

/**
 * 위키백과 티커 → Yahoo 심볼. 클래스 구분자 '.'을 '-'로 바꾼다(BRK.B → BRK-B, BF.B → BF-B).
 * 그 외 문자는 대문자/숫자/하이픈만 허용(예상 밖 문자는 호출부에서 걸러진다).
 */
export function toYahooSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/\./g, '-');
}

/** 정규화된 심볼이 조회 가능한 형태인지(A-Z, 0-9, '-'만). */
export function isPlausibleSymbol(sym: string): boolean {
  return /^[A-Z0-9-]{1,8}$/.test(sym);
}

/**
 * 위키백과 HTML에서 id="constituents" 테이블의 **첫 열(Symbol)** 텍스트를 뽑는다.
 * Parsoid/전통 위키 렌더러 양쪽 모두에서 동작하도록, 테이블 구간을 잘라낸 뒤
 * 행(`<tr>`) 단위로 첫 `<td>`의 태그를 제거해 텍스트만 남긴다.
 * 헤더 행(`<th>`만 있는 행)은 첫 `<td>`가 없으므로 자연히 건너뛴다.
 */
export function parseConstituents(html: string): string[] {
  const idIdx = html.indexOf('id="constituents"');
  if (idIdx < 0) return [];
  const rest = html.slice(idIdx);
  // 테이블 끝(</table>)까지만. 없으면 전체를 대상으로(방어적).
  const endIdx = rest.indexOf('</table>');
  const table = endIdx >= 0 ? rest.slice(0, endIdx) : rest;

  const out: string[] = [];
  const seen = new Set<string>();
  const rows = table.split(/<tr\b/i);
  for (const row of rows) {
    const tdMatch = row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i);
    if (!tdMatch) continue;
    const text = tdMatch[1]
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (text.length === 0) continue;
    const sym = toYahooSymbol(text);
    if (!isPlausibleSymbol(sym)) continue;
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push(text.trim().toUpperCase());
  }
  return out;
}

function readSnapshot(): UniverseSnapshot | null {
  if (!existsSync(UNIVERSE_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(UNIVERSE_FILE, 'utf-8')) as UniverseSnapshot;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.symbols) || parsed.symbols.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshot(snap: UniverseSnapshot): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(UNIVERSE_FILE, JSON.stringify(snap, null, 2));
}

/**
 * S&P500 현재 구성종목 스냅샷을 얻는다(캐시 우선). 네트워크 실패 시 throw 없이 null.
 * onNetwork는 실제 조회 시에만 호출(로그용).
 */
export async function loadSp500Universe(onNetwork?: () => void): Promise<UniverseSnapshot | null> {
  const cached = readSnapshot();
  if (cached) return cached;
  if (onNetwork) onNetwork();
  let html = '';
  try {
    const res = await fetch(WIKIPEDIA_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html',
      },
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }
  const raw = parseConstituents(html);
  if (raw.length < 400) return null; // S&P500 테이블이면 500 내외여야 한다(파싱 실패 방어)
  const snap: UniverseSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    source: WIKIPEDIA_URL,
    fetchedAt: new Date().toISOString(),
    rawSymbols: raw,
    symbols: raw.map(toYahooSymbol),
  };
  writeSnapshot(snap);
  return snap;
}
