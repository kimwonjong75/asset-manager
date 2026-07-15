// scripts/backtest/onboardingPolicy/printHash.ts
// 동결 설정 해시 출력 (결과 확인 전 1회 생성용).

import { configHash, CONFIG_PATH } from './configHash';

const { hash } = configHash();
console.log(`config: ${CONFIG_PATH}`);
console.log(`정규화 SHA-256: ${hash}`);
