// scripts/backtest/conditionalChannel/dataQualityKrSize.ts
// ---------------------------------------------------------------------------
// conditional-channel-kr-size-v1 — 파일 기반 데이터 품질 감사.
//
// 기존 dataQuality.ts(정적 능력 감사, conditional-channel-v1)와는 별개 파일이다.
// 이 감사는 Python 인제스트 파이프라인이 생성한 manifest.json을 읽어 실제 파일
// 기반 게이트를 평가한다. 정적 하드코딩 없음 — 항상 manifest.json을 참조한다.
//
// 게이트:
//   G1  날짜×종목 키 중복 없음
//   G2  거래일 수 정상 범위
//   G3  결측률 < 2%
//   G4  Market 필드 분류 가능
//   G5  보통주 필터 실행됨
//   G6  UNKNOWN 종목 < 5%
//   G7  미분류 기업행위 < 5%
//   G8  상장폐지 커버리지 보고
//   G9  개발·검증·잠금 구간 연속성
//   G10 삼성전자 분할 골든 테스트
//   G11 KRX 공식 교차검증 (WAITING_FOR_USER_KEY → lockbox 차단만)
//
// 규칙: `any` 금지, `console.*` 금지(순수 로직), 외부 I/O 없음.
//        I/O는 callsite(run-kr-size.ts)에서 manifest.json을 먼저 읽어 주입한다.
// ---------------------------------------------------------------------------

import type {
  DataPipelineManifest,
  GateResult,
  KrSizeDataAuditResult,
  KrSizeAuditVerdict,
} from './pipeline/types';

// ===========================================================================
// 1. 매니페스트 없는 경우 — 파이프라인 미실행
// ===========================================================================

/** 매니페스트가 없을 때 반환하는 즉각 실패 결과. */
export function buildManifestMissingResult(manifestPath: string): KrSizeDataAuditResult {
  const missingGate: GateResult = {
    gate: 'MANIFEST_EXISTS',
    passed: false,
    detail:
      `manifest.json 없음: ${manifestPath}\n` +
      '인제스트 파이프라인을 순서대로 실행하세요:\n' +
      '  npm run ingest:kr:download\n' +
      '  npm run ingest:kr:corp-actions\n' +
      '  npm run ingest:kr:universe\n' +
      '  npm run ingest:kr:manifest',
  };

  return {
    hypothesisId: 'conditional-channel-kr-size-v1',
    auditedAt: new Date().toISOString(),
    manifestPath,
    manifest: null,
    gates: [missingGate],
    verdict: 'FAIL',
    failedGates: ['MANIFEST_EXISTS'],
    waitingGates: [],
    prelockAllowed: false,
    lockboxAllowed: false,
    auditScopeNote:
      '파일 기반 감사: manifest.json이 생성되지 않아 게이트 평가 불가. 인제스트 파이프라인을 실행하면 게이트가 자동 평가된다.',
  };
}

// ===========================================================================
// 2. 매니페스트 기반 감사
// ===========================================================================

/**
 * manifest.json을 받아 KR-size 데이터 품질을 평가한다.
 *
 * @param manifest  Python build_manifest.py가 생성한 매니페스트
 * @param manifestPath  감사 기록용 경로 (결과에만 포함)
 * @param auditedAt  감사 시각 ISO 문자열 (테스트에서 주입 가능)
 */
export function runKrSizeDataAudit(
  manifest: DataPipelineManifest,
  manifestPath: string,
  auditedAt?: string
): KrSizeDataAuditResult {
  const ts = auditedAt ?? new Date().toISOString();

  const gates = manifest.gates as GateResult[];

  // lockbox-only 게이트: 실패해도 prelock은 허용하고 lockbox만 차단한다.
  //   G8_DELISTING_COVERAGE: merger_proceeds.json 미완비 → EXCLUDE_OPEN 성과 왜곡 가능
  //   G11_KRX_CROSSCHECK:    data.go.kr 공식 교차검증 미완료
  const LOCKBOX_ONLY_GATES = new Set(['G8_DELISTING_COVERAGE', 'G11_KRX_CROSSCHECK']);

  const prelockGates = gates.filter((g) => !LOCKBOX_ONLY_GATES.has(g.gate));
  const prelockOk = prelockGates.every((g) => g.passed);
  const lockboxOk = gates.every((g) => g.passed);

  const failedGates = prelockGates.filter((g) => !g.passed).map((g) => g.gate);
  const waitingGates = gates
    .filter((g) => LOCKBOX_ONLY_GATES.has(g.gate) && !g.passed)
    .map((g) => g.gate);

  let verdict: KrSizeAuditVerdict;
  if (!prelockOk) {
    verdict = 'FAIL';
  } else if (waitingGates.length > 0) {
    verdict = 'PASS_PRELOCK_KRX_WAIT';
  } else {
    verdict = 'PASS_PRELOCK';
  }

  return {
    hypothesisId: 'conditional-channel-kr-size-v1',
    auditedAt: ts,
    manifestPath,
    manifest,
    gates,
    verdict,
    failedGates,
    waitingGates,
    prelockAllowed: prelockOk,
    lockboxAllowed: lockboxOk,
    auditScopeNote:
      '파일 기반 감사: Python 인제스트(build_manifest.py)가 평가한 게이트를 읽어 판정한다. ' +
      'G8(합병 대가)과 G11(KRX 교차검증)은 prelock은 허용하나 lockbox는 차단한다. ' +
      '게이트 실패 시 인제스트 파이프라인을 재실행해 manifest.json을 갱신한 뒤 재감사한다.',
  };
}

// ===========================================================================
// 3. 감사 결과 요약 출력용 포매터 (CLI 드라이버용 — 순수 문자열 반환)
// ===========================================================================

/** 감사 결과를 사람이 읽을 수 있는 문자열로 반환한다(console 직접 사용 금지). */
export function formatAuditSummary(result: KrSizeDataAuditResult): string {
  const lines: string[] = [
    '='.repeat(80),
    'conditional-channel-kr-size-v1 — 데이터 품질 감사',
    '='.repeat(80),
    `감사 시각: ${result.auditedAt}`,
    `매니페스트: ${result.manifestPath}`,
    `판정: ${result.verdict}`,
    `  prelock 허용: ${result.prelockAllowed ? '✓' : '✗'}`,
    `  lockbox 허용: ${result.lockboxAllowed ? '✓' : `✗ (${result.waitingGates.join(', ') || '게이트 실패'})`}`,
    '',
    '게이트 결과:',
  ];

  for (const g of result.gates) {
    const mark = g.passed ? '✓ PASS' : '✗ FAIL';
    const detail = String(g['detail'] ?? '').slice(0, 100);
    lines.push(`  [${mark}] ${g.gate}: ${detail}`);
  }

  if (result.failedGates.length > 0) {
    lines.push('');
    lines.push(`실패 게이트: ${result.failedGates.join(', ')}`);
  }
  if (result.waitingGates.length > 0) {
    lines.push(`대기 게이트(lockbox 차단): ${result.waitingGates.join(', ')}`);
  }

  lines.push('');
  lines.push(result.auditScopeNote);
  lines.push('='.repeat(80));

  return lines.join('\n');
}

// ===========================================================================
// 4. 개발·검증 기간 선행 확인 (run-kr-size.ts에서 prelock 전에 호출)
// ===========================================================================

/**
 * 개발·검증 기간에 데이터가 실제로 존재하는지 확인한다.
 * 이 확인은 gate G9(날짜 연속성)가 PASS여도 추가로 실행한다.
 */
export function checkDevValPeriodCoverage(
  manifest: DataPipelineManifest,
  devStart: string,
  devEnd: string,
  valStart: string,
  valEnd: string
): { passed: boolean; detail: string } {
  const g9 = manifest.gates.find((g) => g.gate === 'G9_DATE_CONTINUITY');
  if (!g9) {
    return { passed: false, detail: 'G9_DATE_CONTINUITY 게이트 없음 — 매니페스트가 오래됐거나 손상됨' };
  }
  if (!g9.passed) {
    return {
      passed: false,
      detail: `G9 날짜 연속성 실패: ${String(g9['detail'] ?? '')}`,
    };
  }

  // 개발·검증 기간 양 끝 월이 processedFiles에 존재하는지 확인
  const months = [devStart.slice(0, 7), devEnd.slice(0, 7),
                  valStart.slice(0, 7), valEnd.slice(0, 7)];
  const missing = months.filter(
    (ym) => !(`month_end/${ym}.json` in manifest.processedFiles)
  );

  if (missing.length > 0) {
    return {
      passed: false,
      detail: `개발·검증 구간 월 파일 없음: ${missing.join(', ')}`,
    };
  }

  return { passed: true, detail: `개발(${devStart}~${devEnd}) 검증(${valStart}~${valEnd}) 연속성 확인` };
}
