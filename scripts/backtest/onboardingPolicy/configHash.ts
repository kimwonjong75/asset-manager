// scripts/backtest/onboardingPolicy/configHash.ts
// 동결 설정 정규화 SHA-256. 정규화 방법은 PREREG_조건부채널검증.md 와 동일한 재귀 키정렬 방식:
//   객체 키를 재귀적으로 오름차순 정렬(배열 순서 보존) → 공백 없이 JSON.stringify → UTF-8 SHA-256.

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = path.join(__dirname, 'preregistered-config.json');

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function canonicalize(v: Json): Json {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const o: { [k: string]: Json } = {};
    for (const k of Object.keys(v).sort()) o[k] = canonicalize((v as { [k: string]: Json })[k]);
    return o;
  }
  return v;
}

export function configHash(): { hash: string; config: Json } {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Json;
  const hash = createHash('sha256').update(JSON.stringify(canonicalize(config)), 'utf8').digest('hex');
  return { hash, config };
}
