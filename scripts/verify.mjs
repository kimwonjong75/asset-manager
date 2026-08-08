#!/usr/bin/env node
// scripts/verify.mjs
// ---------------------------------------------------------------------------
// 통합 검문소 — 변경 하나가 다른 곳을 깨뜨리지 않았는지 한 번에 확인한다.
//
//   node scripts/verify.mjs            타입검사 + 빠른 회귀 테스트 전부
//   node scripts/verify.mjs --skip-typecheck
//   node scripts/verify.mjs --filter turtle       (이름에 turtle이 든 것만)
//
// 설계 원칙
//   1) **자동 발견**: tests/ 안의 *Parity.ts / *Integrity.ts 를 전부 찾아서 돌린다.
//      npm 스크립트에 등록하는 걸 잊어도 실행에서 빠지지 않는다
//      (실제로 등록 누락 7건이 이 방식 도입 전까지 한 번도 실행되지 않고 있었다).
//   2) **조용한 제외 금지**: tests/ 안에 있는데 어느 분류에도 속하지 않는 파일이 있으면
//      경고가 아니라 **실패**시킨다. 제외 목록이 소리 없이 자라면 검문소는 무의미해진다.
//   3) **저장소 루트 고정**: 일부 테스트가 현재 폴더 기준 상대경로로 소스를 읽는다
//      (guruDiagnosticsParity → scripts/ingest/triage_commit.py). 어디서 호출하든 루트에서 돈다.
//   4) **로컬 tsx 사용**: npx가 매번 네트워크를 조회하지 않도록 설치된 바이너리를 직접 부른다.
//   5) 타입검사와 테스트를 **동시에** 돌려 전체 대기 시간을 줄인다.
// ---------------------------------------------------------------------------

import { readdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT); // 원칙 3

const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

// ── 분류 ─────────────────────────────────────────────────────────────────────
/** 빠른 회귀 — 네트워크·로컬 데이터 없이 도는 순수 테스트. 검문소의 기본 대상. */
const FAST_PATTERN = /(Parity|Integrity)\.ts$/;

/**
 * 느린/데이터 의존 — 검문소에서 제외. 반드시 **이유**를 함께 적는다.
 * (이유 없는 제외를 막기 위해 값이 문자열이어야 한다)
 */
const EXCLUDED = {
  'walkForwardBacktest.ts': '백테스트 — 수 분 소요. npm run backtest 로 수동 실행',
  'conditionalChannelBacktest.ts': '백테스트 — ingest 로 내려받은 로컬 시세 데이터 필요(gitignore)',
  'krSizeBacktest.ts': '백테스트 — ingest 로 내려받은 로컬 시세 데이터 필요(gitignore)',
  'validation.js': '단언 없는 옛 수동 확인 스크립트 — 항상 통과하므로 회귀 가드가 아님',
};

// ── 인자 ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const skipTypecheck = argv.includes('--skip-typecheck');
const filterIdx = argv.indexOf('--filter');
const filter = filterIdx >= 0 ? argv[filterIdx + 1] : null;

// ── 대상 수집 + 고아 검출(원칙 2) ────────────────────────────────────────────
const entries = readdirSync('tests').filter(f => f.endsWith('.ts') || f.endsWith('.js'));
const fast = entries.filter(f => FAST_PATTERN.test(f)).sort();
const orphans = entries.filter(f => !FAST_PATTERN.test(f) && !(f in EXCLUDED));

if (orphans.length) {
  console.error('\n❌ 분류되지 않은 테스트 파일이 있습니다 — 이대로면 영원히 실행되지 않습니다:\n');
  orphans.forEach(f => console.error(`   tests/${f}`));
  console.error('\n   해결: 회귀 테스트면 이름을 *Parity.ts 로, 아니면 scripts/verify.mjs 의');
  console.error('         EXCLUDED 에 제외 이유와 함께 등록하세요.\n');
  process.exit(1);
}

const targets = filter ? fast.filter(f => f.toLowerCase().includes(filter.toLowerCase())) : fast;
if (!targets.length) {
  console.error(`❌ '--filter ${filter}' 에 해당하는 테스트가 없습니다.`);
  process.exit(1);
}

// ── 실행 도우미 ──────────────────────────────────────────────────────────────
function run(cmd, args) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: ROOT, shell: false });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('error', err => resolve({ code: 1, out: `${out}\n${err.message}` }));
    child.on('close', code => resolve({ code: code ?? 1, out }));
  });
}

/** 동시 실행 상한 — CPU를 다 쓰지 않도록 절반만 사용 */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

// ── 본체 ─────────────────────────────────────────────────────────────────────
const started = Date.now();
console.log(`\n🔎 검문소 시작 — 테스트 ${targets.length}개${skipTypecheck ? '' : ' + 타입검사'}\n`);

// 원칙 5: 타입검사를 먼저 띄워 놓고 테스트를 병렬로 돌린다.
const typecheckPromise = skipTypecheck
  ? Promise.resolve(null)
  : existsSync(TSC)
    ? run(process.execPath, [TSC, '--noEmit'])
    : Promise.resolve({ code: 1, out: `typescript 가 설치되어 있지 않습니다: ${TSC}` });

if (!existsSync(TSX)) {
  console.error(`❌ tsx 가 설치되어 있지 않습니다: ${TSX}\n   npm install 을 먼저 실행하세요.`);
  process.exit(1);
}

const limit = Math.max(2, Math.floor(os.cpus().length / 2));
const results = await pool(targets, limit, async file => {
  const t0 = Date.now();
  const r = await run(process.execPath, [TSX, path.join('tests', file)]);
  const ms = Date.now() - t0;
  process.stdout.write(r.code === 0 ? '.' : 'F');
  return { file, ...r, ms };
});
process.stdout.write('\n');

const typecheck = await typecheckPromise;
const failed = results.filter(r => r.code !== 0);

// ── 보고 ─────────────────────────────────────────────────────────────────────
if (failed.length) {
  console.log('\n───────────────────────────── 실패한 테스트 ─────────────────────────────');
  for (const f of failed) {
    console.log(`\n❌ tests/${f.file}`);
    console.log(f.out.trimEnd().split('\n').map(l => '   ' + l).join('\n'));
  }
}

if (typecheck && typecheck.code !== 0) {
  console.log('\n───────────────────────────── 타입 오류 ─────────────────────────────');
  console.log(typecheck.out.trimEnd());
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 3);

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log(`테스트   ${results.length - failed.length}/${results.length} 통과`);
if (typecheck) console.log(`타입검사 ${typecheck.code === 0 ? '통과' : '실패'}`);
console.log(`제외     ${Object.keys(EXCLUDED).length}개 (백테스트·수동 스크립트 — 이유는 scripts/verify.mjs 참조)`);
console.log(`소요     ${secs}초  (가장 느린: ${slowest.map(s => `${s.file.replace(/\.ts$/, '')} ${(s.ms / 1000).toFixed(1)}s`).join(', ')})`);
console.log('═══════════════════════════════════════════════════════════════════════');

const ok = failed.length === 0 && (!typecheck || typecheck.code === 0);
console.log(ok ? '\n✅ 전부 통과 — 안심하고 커밋하세요.\n' : '\n❌ 실패 — 위 내용을 먼저 해결하세요.\n');
process.exit(ok ? 0 : 1);
