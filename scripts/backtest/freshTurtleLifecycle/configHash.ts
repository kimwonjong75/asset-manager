// scripts/backtest/freshTurtleLifecycle/configHash.ts
// 동결 설정 정규화 SHA-256. 재귀 키정렬(배열 순서 보존) → 무공백 stringify → UTF-8 SHA-256.
// (PREREG_조건부채널검증 / onboardingPolicy 와 동일 정규화 규약.)

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = path.join(__dirname, 'config.json');

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

export function configHash(): { hash: string; config: unknown } {
  const config: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  const hash = createHash('sha256').update(JSON.stringify(canonicalize(config as Json)), 'utf8').digest('hex');
  return { hash, config };
}
