// scripts/backtest/spxDipBuy/build.ts — 결과 페이지(단일 HTML, 오프라인) 생성.
//   npx tsx scripts/backtest/spxDipBuy/build.ts   → scripts/backtest/spxDipBuy/report.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadRaw } from './buildSeries';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const out = await build({
    entryPoints: [path.join(__dirname, 'page', 'main.ts')],
    bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none',
  });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const b = loadRaw();
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const gridPath = path.join(__dirname, 'data', 'grid.json');
  const data = {
    fetchedAt: b.fetchedAt,
    dates: b.dates,
    px: b.px.map(r2),
    tr: b.tr.map(v => (isFinite(v) ? r2(v) : null)),
    irx: b.irx.map(r2),
    grid: existsSync(gridPath) ? JSON.parse(readFileSync(gridPath, 'utf8')) : null,
  };
  const tpl = readFileSync(path.join(__dirname, 'page', 'template.html'), 'utf8');
  const html = tpl
    .replace('/*__DATA__*/null', () => JSON.stringify(data))
    .replace('/*__BUNDLE__*/', () => js);
  writeFileSync(path.join(__dirname, 'report.html'), html);
  process.stdout.write(`report.html ${(html.length / 1024).toFixed(0)} KB\n`);
}
main().catch(e => { process.stderr.write(String(e) + '\n'); process.exit(1); });
