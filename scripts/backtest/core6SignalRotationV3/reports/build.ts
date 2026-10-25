// scripts/backtest/core6SignalRotationV3/reports/build.ts
// 실행: npx tsx scripts/backtest/core6SignalRotationV3/reports/build.ts --set W0 | --all | --weights a,b,c,d,e,f --label "이름" [--panel P|P5] [--id slug]
// 비중 순서: 069500,379800,283580,385560,464470,411060. 사후 탐색용 — 채택 판정 불가.

import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { ASSET_CODES } from '../types';
import type { AssetCode } from '../types';
import { WEIGHT_SET_NAMES, renormalizeToPanel, weightSet } from '../run/explorer';
import type { WeightSetName } from '../run/explorer';
import { argValue, isMainModule, loadCd91, loadOrComputeSignalCache, loadPanel, panelWeights, sha256 } from '../run/common';
import type { PanelName } from '../run/common';
import { REPORT_OUT_DIR, buildRecord, writeRecord } from './record';
import { renderReport } from './render';

const SET_LABELS: Record<WeightSetName, string> = {
  W0: '현재 목표비중',
  W1: '동일비중',
  W2: '금 15%',
  W3: '금 35%',
  W4: '채권 제외',
  W5: '주식 70%',
};

function stamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function parseWeightsArg(arg: string): Record<AssetCode, number> {
  const parts = arg.split(',').map(s => Number(s.trim()));
  if (parts.length !== ASSET_CODES.length || parts.some(x => !Number.isFinite(x))) {
    throw new Error(`--weights 는 숫자 ${ASSET_CODES.length}개(${ASSET_CODES.join(',')})`);
  }
  const w = {} as Record<AssetCode, number>;
  ASSET_CODES.forEach((c, i) => (w[c] = parts[i]));
  return w;
}

function run(): void {
  const argv = process.argv;
  const panelArg = argValue(argv, '--panel') ?? 'P';
  if (panelArg !== 'P' && panelArg !== 'P5') throw new Error('--panel P|P5');
  const name: PanelName = panelArg;
  const { panel, sha256: panelSha } = loadPanel(name);
  const cache = loadOrComputeSignalCache(name, panel, panelSha);
  const cd91 = loadCd91();
  const jobs: { id: string; label: string; weights: Record<AssetCode, number> }[] = [];
  const setJob = (s: WeightSetName): void => {
    jobs.push({
      id: name === 'P' ? s : `${s}-${name}`,
      label: `${s} ${SET_LABELS[s]}`,
      weights: renormalizeToPanel(weightSet(s, panelWeights(panel)), panel),
    });
  };
  const setArg = argValue(argv, '--set');
  const wArg = argValue(argv, '--weights');
  if (argv.includes('--all')) {
    for (const s of WEIGHT_SET_NAMES) setJob(s);
  } else if (setArg) {
    if (!WEIGHT_SET_NAMES.includes(setArg as WeightSetName)) throw new Error(`알 수 없는 세트 ${setArg}`);
    setJob(setArg as WeightSetName);
  } else if (wArg) {
    jobs.push({ id: argValue(argv, '--id') ?? `custom-${stamp(new Date())}`, label: argValue(argv, '--label') ?? '사용자 비중', weights: parseWeightsArg(wArg) });
  } else {
    throw new Error('사용법: build.ts (--set W0 | --all | --weights a,b,c,d,e,f --label "이름") [--panel P|P5] [--id slug]');
  }
  mkdirSync(REPORT_OUT_DIR, { recursive: true });
  for (const j of jobs) {
    const rec = buildRecord({ panelName: name, panel, cache, cd91, weights: j.weights, id: j.id, label: j.label });
    const jsonPath = writeRecord(rec);
    const html = renderReport(rec, { recordHash: sha256(JSON.stringify(rec)), generatedAt: new Date().toISOString(), panelSha256: panelSha });
    const htmlPath = path.join(REPORT_OUT_DIR, `${rec.id}.html`);
    writeFileSync(htmlPath, html);
    process.stdout.write(`${rec.id}: ${jsonPath}\n${rec.id}: ${htmlPath}\n`);
  }
}

if (isMainModule(import.meta.url)) run();
