#!/usr/bin/env node
// scripts/backtest/conditionalChannel/tools/compute_config_hash.cjs
//
// 사전등록 설정 파일의 정규화 SHA-256을 계산한다.
// 사용: node scripts/backtest/conditionalChannel/tools/compute_config_hash.cjs \
//           --config=scripts/backtest/conditionalChannel/preregistered-config-kr-size.json
//
// 정규화 방식: 키 재귀 정렬 + JSON.stringify → UTF-8 → SHA-256.
// PREREG 문서의 configHash 칸에 이 출력을 기록한다.

'use strict';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs   = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const crypto = require('crypto');

function sortedJson(val) {
  if (Array.isArray(val)) return val.map(sortedJson);
  if (val !== null && typeof val === 'object') {
    const sorted = {};
    for (const k of Object.keys(val).sort()) sorted[k] = sortedJson(val[k]);
    return sorted;
  }
  return val;
}

function main() {
  const args = process.argv.slice(2);
  const configArg = args.find(a => a.startsWith('--config='));
  if (!configArg) {
    process.stderr.write('사용법: node compute_config_hash.js --config=<경로>\n');
    process.exit(1);
  }
  const configPath = configArg.replace('--config=', '');
  const abs = path.isAbsolute(configPath)
    ? configPath
    : path.join(process.cwd(), configPath);

  let raw;
  try { raw = fs.readFileSync(abs, 'utf8'); }
  catch (e) {
    process.stderr.write(`파일 읽기 실패: ${abs}\n${e.message}\n`);
    process.exit(1);
  }

  let cfg;
  try { cfg = JSON.parse(raw); }
  catch (e) {
    process.stderr.write(`JSON 파싱 실패: ${e.message}\n`);
    process.exit(1);
  }

  const canonical = JSON.stringify(sortedJson(cfg));
  const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

  process.stdout.write(`configHash: ${hash}\n`);
  process.stdout.write(`설정 파일:  ${abs}\n`);
  process.stdout.write(`정규화 길이: ${canonical.length} bytes\n`);
}

main();
