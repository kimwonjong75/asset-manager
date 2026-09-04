#!/usr/bin/env node
// scripts/notify/build-gas.mjs
// ---------------------------------------------------------------------------
// scripts/notify/gas/entry.ts를 esbuild로 IIFE 단일 번들(dist/bundle.js, 전역 `TradePlanNotify`)로
// 묶고, GAS가 요구하는 최상위 함수 스텁(dist/Code.js)을 생성한 뒤 appsscript.json을 복사한다.
//
//   npm run gas:build   →  scripts/notify/gas/dist/{bundle.js, Code.js, appsscript.json}
//   npm run gas:push    →  gas:build 후 clasp push (.clasp.json 필요 — .clasp.json.example 참고)
//
// entry.ts는 utils/tradePlan.ts·utils/marketHours.ts·constants/api.ts 등 앱과 공유하는 순수 TS를
// 그대로 import한다 — Node의 fs/process 등 GAS에 없는 API를 끌어오지 않는지는 이 스크립트가
// 매번 grep으로 확인한다(브라우저 전역도 함께 확인 — window/document/localStorage/fetch).
// import.meta는 esbuild가 target=es2019(비 ESM 출력)에서 빈 객체로 치환하며 경고만 내고
// 빌드를 막지 않는다(constants/api.ts의 `import.meta.env?.…` 폴백 상수값이 그대로 쓰인다) —
// 치환 후 리터럴 "import.meta" 토큰 자체가 사라지므로 아래 grep에도 걸리지 않는다(실측 확인됨).
// ---------------------------------------------------------------------------

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAS_DIR = path.join(ROOT, 'scripts', 'notify', 'gas');
const DIST_DIR = path.join(GAS_DIR, 'dist');
const ENTRY = path.join(GAS_DIR, 'entry.ts');
const GLOBAL_NAME = 'TradePlanNotify';

// entry.ts가 export하는 핸들러 — GAS 최상위 함수로 노출해야 트리거·웹앱이 호출할 수 있다.
const HANDLERS = ['doGet', 'doPost', 'hourlyCheck', 'closeCheck', 'morningDigest', 'installTriggers', 'sendTestMessage'];

// 번들에 남아 있으면 안 되는 브라우저/Node 전용 전역 — GAS V8 런타임에는 없다.
const FORBIDDEN_PATTERNS = [
  { name: 'window', re: /\bwindow\b/ },
  { name: 'document', re: /\bdocument\b/ },
  { name: 'localStorage', re: /\blocalStorage\b/ },
  { name: 'import.meta(리터럴)', re: /import\.meta/ },
  // `.fetch(`(UrlFetchApp.fetch 등 메서드 호출)는 제외 — 전역 브라우저 fetch() 호출만 잡는다.
  { name: '전역 fetch(', re: /(?<![.\w])fetch\(/ },
];

async function main() {
  mkdirSync(DIST_DIR, { recursive: true });

  const bundlePath = path.join(DIST_DIR, 'bundle.js');
  await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    globalName: GLOBAL_NAME,
    target: 'es2019',
    platform: 'neutral',
    minify: false,
    outfile: bundlePath,
    logLevel: 'silent', // import.meta 경고는 의도된 것 — 조용히 진행(아래 grep이 실제 안전성을 확인)
  });

  const bundleText = readFileSync(bundlePath, 'utf8');

  const violations = FORBIDDEN_PATTERNS.filter(p => p.re.test(bundleText));
  if (violations.length > 0) {
    console.error('❌ GAS 번들에 브라우저 전용 참조가 남아 있습니다:');
    violations.forEach(v => console.error(`   - ${v.name}`));
    console.error('   scripts/notify/gas/entry.ts가 import하는 utils/services 경로를 다시 확인하세요.');
    process.exit(1);
  }

  const stubs = HANDLERS
    .map(name => `function ${name}(e) { return ${GLOBAL_NAME}.${name}(e); }`)
    .join('\n');
  writeFileSync(path.join(DIST_DIR, 'Code.js'), stubs + '\n', 'utf8');

  copyFileSync(path.join(GAS_DIR, 'appsscript.json'), path.join(DIST_DIR, 'appsscript.json'));

  console.log(
    `✅ GAS 번들 생성 완료 (${path.relative(ROOT, DIST_DIR)}): ` +
    `bundle.js ${bundleText.length.toLocaleString()}자, Code.js ${HANDLERS.length}개 스텁, appsscript.json 복사됨. ` +
    `브라우저 전용 전역 참조 없음 확인.`,
  );
}

main().catch(e => {
  console.error('❌ GAS 빌드 실패:', e);
  process.exit(1);
});
