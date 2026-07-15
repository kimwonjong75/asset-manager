// scripts/backtest/conditionalChannel/report.ts
// ---------------------------------------------------------------------------
// 조건부 돌파 채널 가설(PROMPT_3 §17) — 최종 보고서 마크다운 순수 포매터.
//
//   · 입력 결과객체(ConditionalChannelReportHeader + 본문 섹션)를 §17 구조의 마크다운으로 변환.
//   · 순서: 판정 → 한 문장 답 → 증거 등급 → 핵심 표 → 채택 게이트 → 한계·다음행동,
//     그 뒤 계보/QA/종목군/실행규칙/성과/통계/분해/비용/강건성/집중도/제외/재현.
//   · ⚠ 이 함수는 이번 배포에서 실제 REPORT_조건부채널검증.md를 생성하는 데 쓰지 않는다
//     (Phase 0 게이트 FAIL → 실행 결과 없음). 작은 합성 결과로 단위 테스트만 한다.
//     실제 강제 중단 산출물은 DATA_GAP_조건부채널검증.md(Phase 1)이다.
//
// 규칙: `any` 금지, `console.*` 금지(순수 로직 — 문자열만 반환), 외부 I/O 없음.
// ---------------------------------------------------------------------------

import type {
  ConditionalChannelReportHeader,
  EstimateWithInterval,
  ExclusionRecord,
  InteractionEstimate,
  PerformanceSummary,
} from '../../../types/backtestConditionalChannel';

// ===========================================================================
// 본문 섹션 형태 정의(헤더는 Phase 1 타입 재사용, 본문만 여기서 정의)
// ===========================================================================

export interface CostComparisonRow {
  strategyId: string;
  costTier: string;
  cagr: number;
  sharpe: number;
  maxDrawdown: number;
}

export interface RobustnessRow {
  label: string;        // 예: '진입 룩백 15/25', '비용 2배', 'leave-one-out: 최대기여 종목'
  interactionSign: 'POSITIVE' | 'NEGATIVE' | 'ZERO' | 'NA';
  note: string;
}

/** §17 본문 섹션 묶음(헤더 뒤에 배치). */
export interface ConditionalChannelReportBody {
  dataLineageAndQa: string;        // 데이터 계보·QA
  universeDefinition: string;      // 종목군 정의
  executionRules: string;          // 실행 규칙
  performance: PerformanceSummary[]; // 전체 성과(전략×시장×그룹×티어)
  costComparison: CostComparisonRow[]; // 기본 vs 2배 비용 정책 비교
  robustness: RobustnessRow[];     // 강건성·위약 검정
  concentration: string;           // 거래 집중도(leave-one-out 요약)
  exclusions: ExclusionRecord[];   // 제외 목록
  reproduction: string;            // 재현 방법(명령·시드·설정 해시)
}

export interface ConditionalChannelReportInput {
  header: ConditionalChannelReportHeader;
  body: ConditionalChannelReportBody;
}

// ===========================================================================
// 포맷 헬퍼
// ===========================================================================

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}
function num(x: number, digits = 4): string {
  return Number.isFinite(x) ? x.toFixed(digits) : '—';
}
function estCell(e: EstimateWithInterval): string {
  return `${num(e.pointEstimate)} [${num(e.ciLower)}, ${num(e.ciUpper)}], p=${num(e.pValue, 3)}`;
}

function interactionTable(rows: readonly InteractionEstimate[]): string {
  const head =
    '| 시장 | ΔA (점추정 [95% CI], p) | ΔB (점추정 [95% CI], p) | I = ΔA−ΔB (점추정 [95% CI], p) |\n' +
    '|---|---|---|---|';
  if (rows.length === 0) {
    return head + '\n| — | 데이터 없음(Phase 0 게이트 FAIL) | — | — |';
  }
  const body = rows
    .map((r) => `| ${r.market} | ${estCell(r.deltaA)} | ${estCell(r.deltaB)} | ${estCell(r.interactionI)} |`)
    .join('\n');
  return `${head}\n${body}`;
}

function adoptionGateTable(header: ConditionalChannelReportHeader): string {
  const head = '| 게이트 | 판정 | 근거 |\n|---|---|---|';
  if (header.adoptionGates.length === 0) {
    return head + '\n| (10개 채택 게이트) | NA | Phase 0 데이터 게이트 FAIL — 성과 미산출 |';
  }
  const body = header.adoptionGates
    .map((g) => `| ${g.id} | ${g.status} | ${g.description}: ${g.evidence} |`)
    .join('\n');
  return `${head}\n${body}`;
}

function performanceTable(rows: readonly PerformanceSummary[]): string {
  const head =
    '| 전략 | 시장 | 그룹 | 티어 | 거래수 | 승률 | CAGR | Vol | Sharpe | Sortino | MDD | Calmar | 평균R | 중앙R | PF | 보유일 | 노출 | 회전 |\n' +
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  if (rows.length === 0) return head + '\n| — | — | — | — | 0 | — | — | — | — | — | — | — | — | — | — | — | — | — |';
  const body = rows
    .map(
      (r) =>
        `| ${r.strategyId} | ${r.market} | ${r.group} | ${r.costTier} | ${r.tradeCount} | ${pct(r.winRate)} | ${pct(
          r.cagr
        )} | ${pct(r.annualizedVol)} | ${num(r.sharpe, 2)} | ${num(r.sortino, 2)} | ${pct(r.maxDrawdown)} | ${num(
          r.calmar,
          2
        )} | ${num(r.avgR, 2)} | ${num(r.medianR, 2)} | ${num(r.profitFactor, 2)} | ${num(
          r.avgHoldingDays,
          1
        )} | ${pct(r.exposure)} | ${num(r.turnover, 2)} |`
    )
    .join('\n');
  return `${head}\n${body}`;
}

function costComparisonTable(rows: readonly CostComparisonRow[]): string {
  const head = '| 전략 | 비용 티어 | CAGR | Sharpe | MDD |\n|---|---|---|---|---|';
  if (rows.length === 0) return head + '\n| — | — | — | — | — |';
  return (
    head +
    '\n' +
    rows.map((r) => `| ${r.strategyId} | ${r.costTier} | ${pct(r.cagr)} | ${num(r.sharpe, 2)} | ${pct(r.maxDrawdown)} |`).join('\n')
  );
}

function robustnessTable(rows: readonly RobustnessRow[]): string {
  const head = '| 강건성/위약 항목 | I 부호 | 비고 |\n|---|---|---|';
  if (rows.length === 0) return head + '\n| — | NA | — |';
  return head + '\n' + rows.map((r) => `| ${r.label} | ${r.interactionSign} | ${r.note} |`).join('\n');
}

function exclusionTable(rows: readonly ExclusionRecord[]): string {
  const head = '| securityId | 심볼 | 시장 | 제외 사유 |\n|---|---|---|---|';
  if (rows.length === 0) return head + '\n| — | — | — | (제외 없음) |';
  return head + '\n' + rows.map((r) => `| ${r.securityId} | ${r.symbol} | ${r.market} | ${r.reason} |`).join('\n');
}

// ===========================================================================
// 메인 포매터 (§17)
// ===========================================================================

/**
 * §17 최종 보고서 마크다운 생성. 첫 화면(판정→한문장답→증거등급→핵심표→채택게이트→한계)
 * 순서를 강제하고, 뒤이어 계보/종목군/실행/성과/통계/비용/강건성/집중도/제외/재현을 배치한다.
 */
export function formatReport(input: ConditionalChannelReportInput): string {
  const { header, body } = input;
  const lines: string[] = [];

  lines.push('# 조건부 돌파 채널 가설 검증 — 최종 보고서');
  lines.push('');

  // 1. 판정
  lines.push(`## 판정: ${header.verdict}`);
  lines.push('');
  // 2. 한 문장 답
  lines.push(`**한 문장 답:** ${header.oneSentenceAnswer}`);
  lines.push('');
  // 3. 증거 등급
  lines.push(
    `**증거 등급:** ${header.evidenceGrade} · 데이터 as-of: ${header.dataAsOf ?? '없음(N/A)'} · 설정 해시: \`${header.configHash}\``
  );
  lines.push('');
  // 4. 핵심 표
  lines.push('## 핵심 표 — ΔA / ΔB / I 와 전략 비교');
  lines.push('');
  lines.push(interactionTable(header.interaction));
  lines.push('');
  // 5. 채택 게이트
  lines.push('## 채택 게이트 (10개 조건 PASS/FAIL/NA)');
  lines.push('');
  lines.push(adoptionGateTable(header));
  lines.push('');
  // 6. 가장 중요한 한계와 다음 행동
  lines.push('## 가장 중요한 한계와 다음 행동');
  lines.push('');
  lines.push(header.keyLimitationsAndNextActions);
  lines.push('');

  // ── Phase 0 게이트 상태 명시 ──
  lines.push('## Phase 0 데이터 게이트');
  lines.push('');
  lines.push(
    `- 판정: **${header.dataGate.verdict}** · 충족된 하드스톱: ${
      header.dataGate.metConditionIds.length
    }/8 (${header.dataGate.metConditionIds.join(', ') || '없음'})`
  );
  if (header.dataGate.verdict === 'FAIL') {
    lines.push(
      '- 게이트 FAIL 상태이므로 성과 추정치는 생성되지 않았다. 강제 중단 산출물은 `docs/backtest/DATA_GAP_조건부채널검증.md`.'
    );
  }
  lines.push('');

  // ── 상세 섹션 ──
  lines.push('## 데이터 계보와 QA');
  lines.push('');
  lines.push(body.dataLineageAndQa);
  lines.push('');
  lines.push('## 종목군 정의');
  lines.push('');
  lines.push(body.universeDefinition);
  lines.push('');
  lines.push('## 실행 규칙');
  lines.push('');
  lines.push(body.executionRules);
  lines.push('');
  lines.push('## 전체 성과');
  lines.push('');
  lines.push(performanceTable(body.performance));
  lines.push('');
  lines.push('## 비용·수용 가능 규모 (기본 vs 2배)');
  lines.push('');
  lines.push(costComparisonTable(body.costComparison));
  lines.push('');
  lines.push('## 강건성·위약 검정');
  lines.push('');
  lines.push(robustnessTable(body.robustness));
  lines.push('');
  lines.push('## 거래 집중도');
  lines.push('');
  lines.push(body.concentration);
  lines.push('');
  lines.push('## 제외 목록');
  lines.push('');
  lines.push(exclusionTable(body.exclusions));
  lines.push('');
  lines.push('## 재현 방법');
  lines.push('');
  lines.push(body.reproduction);
  lines.push('');

  return lines.join('\n');
}
