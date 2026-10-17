// scripts/backtest/core6SignalRotationV3/run/selectionLock.ts
// 코어 6종 신호 로테이션 V3 — 선택 잠금 파일(V2 §7.2-6). 상위 2개 규칙·불타기 간격·개발 요약·패널/신호캐시/코드/설정 해시.
// 실행: npx tsx scripts/backtest/core6SignalRotationV3/run/selectionLock.ts --panel P|P5   (개발구간을 재실행해 잠금 생성)
// 잠금은 한 번 만들면 덮어쓰지 않는다. 사용자가 이 파일을 커밋한 뒤에만 runValidation 을 쓴다.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { runDevelopment } from './devRun';
import type { DevResult, SelectedRule } from './devRun';
import {
  CAP_ABSOLUTE,
  CAP_MULTIPLIER,
  COST_ADVERSE,
  COST_BASE,
  DEV_END_DATE,
  INITIAL_CAPITAL,
  MIN_OFFSET_DAYS,
  MIN_ORDER_KRW,
  OFFSETS,
  OUTPUT_DIR,
  PYRAMID_INTERVALS,
  THRESHOLDS,
  V3_DIR,
  VAL_START_DATE,
  argValue,
  computeSignalCache,
  isMainModule,
  jsonHash,
  loadPanel,
  sha256,
  truncatePanel,
} from './common';
import type { PanelName } from './common';
import type { Panel } from '../types';

export const LOCK_PATH = path.join(OUTPUT_DIR, 'SELECTION_LOCK.json');

export interface LockHashes {
  panelSha256: string;
  /** 개발구간(DEV_END_DATE 까지)으로 자른 패널의 신호 캐시 해시(인과적이므로 전체 캐시의 접두와 같다). */
  devSignalCacheSha256: string;
  codeSha256: string;
  configSha256: string;
  preregSha256: string;
}

export interface SelectionLock {
  schema: 'core6-v3-selection-lock-v1';
  createdAtUtc: string;
  panel: PanelName;
  devEndDate: string;
  validationStart: string;
  ranking: string[];
  selected: SelectedRule[];
  devSummary: { rule: string; medianMddReduction: number; medianCalmarImprovement: number; medianTurnover: number; cagrOkOffsets: number; rankUnstable: boolean }[];
  hashes: LockHashes;
}

/** 결과에 영향을 주는 코드만 해시한다(탐색기·CLI 래퍼는 제외). */
const CODE_FILES = [
  'types.ts',
  'signals/signals.ts',
  'portfolio/simulate.ts',
  'portfolio/alloc.ts',
  'stats/metrics.ts',
  'run/common.ts',
  'run/devRun.ts',
  'run/runValidation.ts',
];

export function codeHash(): string {
  const parts = CODE_FILES.map(f => `${f}\n${readFileSync(path.join(V3_DIR, f), 'utf-8').replace(/\r\n/g, '\n')}`);
  return sha256(parts.join('\n---\n'));
}

export function configHash(): string {
  return jsonHash({
    THRESHOLDS,
    OFFSETS,
    MIN_OFFSET_DAYS,
    COST_BASE,
    COST_ADVERSE,
    CAP_MULTIPLIER,
    CAP_ABSOLUTE,
    INITIAL_CAPITAL,
    MIN_ORDER_KRW,
    PYRAMID_INTERVALS,
    DEV_END_DATE,
    VAL_START_DATE,
  });
}

export function preregHash(): string {
  const p = path.resolve(V3_DIR, '..', '..', '..', 'docs', 'backtest', 'PREREG_코어6종_신호로테이션_V3.md');
  return sha256(readFileSync(p));
}

export function computeHashes(panel: Panel, panelSha: string): LockHashes {
  return {
    panelSha256: panelSha,
    devSignalCacheSha256: jsonHash(computeSignalCache(truncatePanel(panel, DEV_END_DATE))),
    codeSha256: codeHash(),
    configSha256: configHash(),
    preregSha256: preregHash(),
  };
}

export function buildLock(dev: DevResult, hashes: LockHashes): SelectionLock {
  if (dev.status !== 'SELECTED') throw new Error(`선택 잠금 불가: 개발 결과 상태 = ${dev.status} (${dev.holdReason ?? ''})`);
  return {
    schema: 'core6-v3-selection-lock-v1',
    createdAtUtc: new Date().toISOString(),
    panel: dev.panel,
    devEndDate: dev.devEndDate,
    validationStart: VAL_START_DATE,
    ranking: dev.ranking.slice(),
    selected: dev.selected,
    devSummary: dev.selected.map(s => {
      const r = dev.rules.find(x => x.rule === s.rule);
      if (!r) throw new Error(`내부 오류: ${s.rule} 개발 요약 없음`);
      return {
        rule: r.rule,
        medianMddReduction: r.medianMddReduction,
        medianCalmarImprovement: r.medianCalmarImprovement,
        medianTurnover: r.medianTurnover,
        cagrOkOffsets: r.cagrOkOffsets,
        rankUnstable: r.rankUnstable,
      };
    }),
    hashes,
  };
}

export function writeLock(lock: SelectionLock, lockPath: string = LOCK_PATH): void {
  if (existsSync(lockPath)) throw new Error(`선택 잠금이 이미 존재합니다(덮어쓰기 금지): ${lockPath}`);
  writeFileSync(lockPath, JSON.stringify(lock, null, 2));
}

/** 잠금 파일을 읽는다. 없으면 throw. */
export function readLock(lockPath: string = LOCK_PATH): SelectionLock {
  if (!existsSync(lockPath)) throw new Error(`선택 잠금 파일이 없습니다: ${lockPath} — 검증구간 실행 불가.`);
  return JSON.parse(readFileSync(lockPath, 'utf-8')) as SelectionLock;
}

/** 현재 해시와 잠금의 해시를 대조한다. 하나라도 다르면 throw. */
export function verifyLockHashes(lock: SelectionLock, current: LockHashes): void {
  const keys = Object.keys(current) as (keyof LockHashes)[];
  const bad = keys.filter(k => lock.hashes[k] !== current[k]);
  if (bad.length > 0) throw new Error(`선택 잠금 해시 불일치: ${bad.join(', ')} — 검증구간 실행 불가.`);
}

if (isMainModule(import.meta.url)) {
  const panelArg = argValue(process.argv, '--panel');
  if (panelArg !== 'P' && panelArg !== 'P5') throw new Error('사용법: selectionLock.ts --panel P|P5');
  const { panel, sha256: panelSha } = loadPanel(panelArg);
  const dev = runDevelopment(panel, panelArg);
  const lock = buildLock(dev, computeHashes(panel, panelSha));
  writeLock(lock);
  process.stdout.write(`선택 잠금 저장: ${LOCK_PATH}\n선정: ${lock.selected.map(s => `${s.rule}(${s.pyramidInterval ?? '불타기 없음'})`).join(', ')}\n`);
}
