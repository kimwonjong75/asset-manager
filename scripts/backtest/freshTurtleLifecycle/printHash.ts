// scripts/backtest/freshTurtleLifecycle/printHash.ts
// 결과 확인 전 1회 해시 출력용.

import { configHash, CONFIG_PATH } from './configHash';

const { hash } = configHash();
console.log(`config: ${CONFIG_PATH}`);
console.log(`정규화 SHA-256: ${hash}`);
