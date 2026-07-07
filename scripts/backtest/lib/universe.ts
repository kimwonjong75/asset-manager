// scripts/backtest/lib/universe.ts
// scripts/backtest/data/universe.json 로더 + 타입.

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type AssetClass = 'CORE' | 'SATELLITE_TURTLE' | 'EXIT_LEGACY' | 'CASH' | 'AMBIGUOUS';

export interface UniverseAsset {
  name: string;
  rawTicker: string;
  owner: string;
  class: AssetClass;
  currency: 'KRW' | 'USD' | 'JPY' | string;
  dataSymbol: string;
  proxySymbol: string | null;
  proxyReason?: string | null;
  probeOk: boolean;
  proxyProbeOk?: boolean;
  weightPct: number;
  notes?: string;
}

export interface FxEntry {
  pair: string;
  symbol: string;
  probeOk: boolean;
}

export interface ExcludedAsset {
  name: string;
  rawTicker: string;
  owner: string;
  class: AssetClass;
  reason: string;
  weightPct: number;
  recommendation?: string;
}

export interface Universe {
  generatedAt: string;
  fx: FxEntry[];
  assets: UniverseAsset[];
  excluded: ExcludedAsset[];
  openQuestions: string[];
}

export function loadUniverse(): Universe {
  const file = path.join(__dirname, '..', 'data', 'universe.json');
  return JSON.parse(readFileSync(file, 'utf-8'));
}

/** 백테스트에 실제 사용할 가격 조회 심볼 (프록시 우선 — universe.json이 이미 장기 히스토리용으로 지정). */
export function fetchSymbolOf(asset: UniverseAsset): string {
  return asset.proxySymbol ?? asset.dataSymbol;
}

/** 이 자산이 프록시 기반 시계열인지 (리포트에 명시 필요). */
export function isProxyBased(asset: UniverseAsset): boolean {
  return asset.proxySymbol != null;
}
