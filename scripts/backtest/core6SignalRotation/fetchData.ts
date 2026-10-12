import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(root, 'data', 'raw');
mkdirSync(rawDir, { recursive: true });

const START = '2002-01-01';
const END = '2026-09-30';
const YAHOO_SYMBOLS = [
  '069500.KS', '379800.KS', '283580.KS', '385560.KS', '464470.KS', '411060.KS',
  'SPY', '3188.HK', 'TLT', 'KRW=X', 'HKDKRW=X', 'HKD=X',
];

function epoch(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
}

function safe(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9_.=-]/g, '_');
}

async function getText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; core6-data-audit/1.0)',
      Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

async function fetchYahoo(): Promise<void> {
  for (const symbol of YAHOO_SYMBOLS) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?period1=${epoch(START)}&period2=${epoch('2026-10-01')}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
    const text = await getText(url);
    const payload = {
      sourceUrl: url,
      fetchedAtUtc: new Date().toISOString(),
      requestedPeriod: { start: START, end: END },
      response: JSON.parse(text) as unknown,
    };
    writeFileSync(path.join(rawDir, `yahoo_${safe(symbol)}.json`), JSON.stringify(payload));
    console.log(`Yahoo ${symbol}: ${text.length} bytes`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

interface EcosEnvelope {
  StatisticSearch?: {
    list_total_count?: number;
    row?: unknown[];
  };
}

async function fetchEcos(): Promise<void> {
  const rows: unknown[] = [];
  let total = Number.POSITIVE_INFINITY;
  const urls: string[] = [];
  for (let start = 1; start <= total; start += 10) {
    const end = start + 9;
    const url = `https://ecos.bok.or.kr/api/StatisticSearch/sample/json/kr/${start}/${end}/817Y002/D/20210101/20260930/010502000`;
    const parsed = JSON.parse(await getText(url)) as EcosEnvelope;
    total = parsed.StatisticSearch?.list_total_count ?? 0;
    rows.push(...(parsed.StatisticSearch?.row ?? []));
    urls.push(url);
    if (total === 0) break;
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  writeFileSync(path.join(rawDir, 'ecos_cd91.json'), JSON.stringify({
    sourceUrls: urls,
    fetchedAtUtc: new Date().toISOString(),
    requestedPeriod: { start: '2021-01-01', end: END },
    statCode: '817Y002',
    itemCode: '010502000',
    rows,
  }));
  console.log(`ECOS CD91: ${rows.length} rows`);
}

async function fetchNaverGold(): Promise<void> {
  const rows: unknown[] = [];
  const urls: string[] = [];
  for (let page = 1; page <= 80; page++) {
    const url = `https://api.stock.naver.com/marketindex/metals/M04020000/prices?page=${page}&pageSize=60`;
    const pageRows = JSON.parse(await getText(url)) as Array<Record<string, unknown>>;
    urls.push(url);
    if (pageRows.length === 0) break;
    rows.push(...pageRows);
    const oldest = String(pageRows.at(-1)?.localTradedAt ?? '').slice(0, 10);
    if (oldest && oldest < '2014-03-24') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  writeFileSync(path.join(rawDir, 'naver_krx_gold_close.json'), JSON.stringify({
    sourceUrls: urls,
    fetchedAtUtc: new Date().toISOString(),
    sourceDescription: 'Naver Finance marketindex KRX domestic gold, sourced from KRX; close history only',
    rows,
  }));
  console.log(`Naver KRX gold close: ${rows.length} rows`);

  const goldNowUrl = 'https://goldnow.infovista.kr/gold/history?source=krx&start_date=2023-08-22&end_date=2026-09-30';
  const html = await getText(goldNowUrl);
  writeFileSync(path.join(rawDir, 'goldnow_krx_gold_ohlc.html'), html);
  writeFileSync(path.join(rawDir, 'goldnow_krx_gold_ohlc.meta.json'), JSON.stringify({
    sourceUrl: goldNowUrl,
    fetchedAtUtc: new Date().toISOString(),
    note: 'Secondary display backed by Financial Services Commission general commodity data; available coverage is verified in processing.',
  }));
  console.log(`GoldNow KRX gold OHLC HTML: ${html.length} bytes`);
}

function checksumFiles(): void {
  const names = [
    ...YAHOO_SYMBOLS.map(symbol => `yahoo_${safe(symbol)}.json`),
    'ecos_cd91.json',
    'naver_krx_gold_close.json',
    'goldnow_krx_gold_ohlc.html',
    'goldnow_krx_gold_ohlc.meta.json',
  ];
  const checksums = names.map(name => {
    const data = readFileSync(path.join(rawDir, name));
    return { file: name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  });
  writeFileSync(path.join(rawDir, 'checksums.json'), JSON.stringify({ generatedAtUtc: new Date().toISOString(), files: checksums }, null, 2));
}

await fetchYahoo();
await fetchEcos();
await fetchNaverGold();
checksumFiles();
