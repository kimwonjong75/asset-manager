// scripts/backtest/conditionalChannel/run.ts
// ---------------------------------------------------------------------------
// 조건부 돌파 채널 가설(PROMPT_3 §16) — CLI 드라이버.
//
//   실행: npx --yes tsx scripts/backtest/conditionalChannel/run.ts --phase=data-audit
//         npm run backtest:conditional-channel -- --phase=prelock
//         npm run backtest:conditional-channel -- --phase=lockbox
//
//   · data-audit: runDataAudit() 실행 → 하드스톱 판정 요약 출력. PASS면 exit 0, FAIL이면 exit 1.
//   · prelock/lockbox: 먼저 runDataAudit(). verdict FAIL이면 성과 추정치를 절대 생성하지 않고
//     DATA_GAP 보고서를 안내한 뒤 비정상 종료(§16). 현재 게이트는 FAIL(8/8)이다.
//
// 이 파일은 CLI 드라이버이므로 console.* 사용이 허용된다(gate0Audit.ts 관례와 동일).
// 순수 로직(dataQuality/classifier/simulator/statistics/report)은 console을 쓰지 않는다.
// 네트워크 호출·하드코딩 URL·`any` 없음.
// ---------------------------------------------------------------------------

import { runDataAudit } from './dataQuality';
import type { DataAuditResult } from '../../../types/backtestConditionalChannel';

type Phase = 'data-audit' | 'prelock' | 'lockbox';

const DATA_GAP_DOC = 'docs/backtest/DATA_GAP_조건부채널검증.md';

function parsePhase(argv: readonly string[]): Phase | null {
  for (const arg of argv) {
    const m = /^--phase=(.+)$/.exec(arg);
    if (m) {
      const v = m[1];
      if (v === 'data-audit' || v === 'prelock' || v === 'lockbox') return v;
      return null;
    }
  }
  return null;
}

function printAuditSummary(audit: DataAuditResult): void {
  console.log('='.repeat(80));
  console.log('조건부 돌파 채널 — Phase 0 데이터 가능성 감사(PROMPT_3 §3)');
  console.log('='.repeat(80));
  console.log(`가설: ${audit.hypothesisId}`);
  console.log(`감사 시각: ${audit.auditedAt}`);
  console.log(`판정: ${audit.verdict}  (충족 하드스톱 ${audit.metConditionIds.length}/8)`);
  console.log('');
  console.log('하드스톱 조건별 판정:');
  for (const c of audit.conditions) {
    const mark = c.met ? '✗ 충족(중단기여)' : '✓ 미충족';
    console.log(`  [${mark}] ${c.id}`);
    console.log(`      ${c.description}`);
    console.log(`      근거: ${c.evidence}`);
  }
  console.log('');
  console.log('확증 진행에 필요한 외부 입력:');
  for (const inp of audit.requiredExternalInputs) {
    console.log(`  - ${inp}`);
  }
  console.log('');
  console.log(`감사 범위: ${audit.auditScopeNote}`);
  console.log('='.repeat(80));
}

function runDataAuditPhase(): number {
  const audit = runDataAudit();
  printAuditSummary(audit);
  if (audit.verdict === 'PASS') {
    console.log('\n결과: PASS — 확증 백테스트 진행 가능(사전등록·잠금 절차로).');
    return 0;
  }
  console.log('\n결과: FAIL — 1차 확증 백테스트를 실행하지 않는다.');
  console.log(`강제 중단 보고서: ${DATA_GAP_DOC}`);
  return 1;
}

function runGatedPhase(phase: 'prelock' | 'lockbox'): number {
  console.log('='.repeat(80));
  console.log(`조건부 돌파 채널 — ${phase} 단계`);
  console.log('='.repeat(80));
  console.log('먼저 Phase 0 데이터 가능성 감사를 실행한다(§16 하드 게이트).');
  console.log('');

  const audit = runDataAudit();
  if (audit.verdict === 'FAIL') {
    console.log(`데이터 게이트 판정: FAIL (충족 하드스톱 ${audit.metConditionIds.length}/8)`);
    console.log(`  충족 조건: ${audit.metConditionIds.join(', ')}`);
    console.log('');
    console.log('⛔ 성과 추정치를 생성하지 않는다.');
    console.log('   point-in-time 전체 시장 종목군·역사적 시가총액·역사적 업종 분류·상장폐지 데이터가');
    console.log('   확보되지 않아 확증(또는 잠금) 백테스트가 원리적으로 불가하다(§3·§16).');
    console.log('   합성값/현재값으로 채워 확증 결과를 만드는 것은 금지된다.');
    console.log('');
    console.log(`   강제 중단 보고서: ${DATA_GAP_DOC}`);
    console.log(`   확보해야 할 외부 입력(${audit.requiredExternalInputs.length}건):`);
    for (const inp of audit.requiredExternalInputs) {
      console.log(`     - ${inp}`);
    }
    console.log('='.repeat(80));
    return 1;
  }

  // 게이트 PASS 경로(현재 도달 불가 — 외부 데이터 배선 후에만).
  console.log('데이터 게이트 판정: PASS');
  console.log('사전등록 설정을 잠금하고 시뮬레이션/통계를 실행할 수 있다.');
  console.log('(실제 데이터 로딩·시뮬레이션 배선은 외부 point-in-time 소스 확보 후 구현한다.)');
  console.log('='.repeat(80));
  return 0;
}

function main(): void {
  const phase = parsePhase(process.argv.slice(2));
  if (phase === null) {
    console.error('사용법: --phase=data-audit | prelock | lockbox');
    process.exit(2);
    return;
  }

  let code: number;
  if (phase === 'data-audit') code = runDataAuditPhase();
  else code = runGatedPhase(phase);

  process.exit(code);
}

main();
