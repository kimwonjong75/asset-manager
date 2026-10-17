// scripts/backtest/core6SignalRotationV3/data/fetchBackendFill.ts
// 실행: npx --yes tsx scripts/backtest/core6SignalRotationV3/data/fetchBackendFill.ts
// Amendment 1 (A1-1): 앱 백엔드 /history 에서 6종의 OHLC를 새로 조회해 output/backend_fill/ 에 원본 응답과 SHA-256을 저장한다.
// 기존 캐시(scripts/backtest/data/cache)는 읽지도 쓰지도 않는다. 이미 파일이 있으면 재조회하지 않는다(--force 로만 덮어쓴다).

import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ASSET_CODES } from '../types';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'output', 'backend_fill');
const force = process.argv.includes('--force');

async function main(): Promise<void> {
  const { CLOUD_RUN_BASE_URL } = await import('../../../../constants/api');
  mkdirSync(outDir, { recursive: true });
  const manifest: Array<{ symbol: string; file: string; sha256: string; bytes: number; fetchedAtUtc: string; startDate: string; endDate: string; requestUrl: string }> = [];
  for (const code of ASSET_CODES) {
    const file = path.join(outDir, `${code}.json`);
    if (existsSync(file) && !force) {
      console.log(`skip ${code} (exists)`);
      continue;
    }
    const startDate = '2021-12-15';
    const endDate = '2026-10-01';
    const res = await fetch(`${CLOUD_RUN_BASE_URL}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: [code], start_date: startDate, end_date: endDate }),
    });
    if (!res.ok) throw new Error(`${code}: HTTP ${res.status}`);
    const text = await res.text();
    const hash = createHash('sha256').update(text).digest('hex');
    const fetchedAtUtc = new Date().toISOString();
    writeFileSync(file, text);
    manifest.push({ symbol: code, file: `output/backend_fill/${code}.json`, sha256: hash, bytes: Buffer.byteLength(text), fetchedAtUtc, startDate, endDate, requestUrl: `${CLOUD_RUN_BASE_URL}/history` });
    console.log(`${code} ${Buffer.byteLength(text)}B sha256=${hash}`);
  }
  if (manifest.length > 0) writeFileSync(path.join(outDir, `fetch_manifest_${Date.now()}.json`), JSON.stringify(manifest, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
