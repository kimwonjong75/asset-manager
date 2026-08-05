// tests/soldPLBreakdownParity.ts
// ---------------------------------------------------------------------------
// 매도 실현손익 이익/손실 분해(utils/soldPLBreakdown) 회귀 테스트 — 순수 함수만 검증(React/DOM 없음).
//
// 고정 대상:
//   · **항등식**: grossProfit + grossLoss === 총 실현손익 (카드의 "매도 수익"과 반드시 일치)
//   · 0원 건은 이익/손실 어느 건수에도 들어가지 않는다 (매수정보 없음 폴백이 이익으로 부풀지 않게)
//   · grossLoss는 음수 부호 유지, 표기 부호(+/−)는 buildSoldPLBreakdownRows가 붙인다
//   · NaN/Infinity 오염 차단 · 입력 배열 불변
//   · **실사용 골든값**: 실제 매도 41건 스냅샷의 절대값을 명시 고정 (경로 대조가 아닌 고정 숫자)
//
// 수동 실행: npm run test:soldpl. 통과 시 exit 0.

import {
  splitRealizedPL,
  buildSoldPLBreakdownRows,
  EMPTY_REALIZED_PL_BREAKDOWN,
  type RealizedPLBreakdown,
} from '../utils/soldPLBreakdown';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

// 표기 확인을 안정적으로 하기 위한 고정 포맷터(Intl 로캘 환경차 배제)
const fmt = (v: number) => `₩${Math.round(v).toLocaleString('en-US')}`;

// ════════════════════════════════════════════════════════════════════════════
// 1. 기본 분해 — 부호별 합계와 건수
// ════════════════════════════════════════════════════════════════════════════
{
  const out = splitRealizedPL([100, -30, 250, -70, 5]);
  check('grossProfit 합', out.grossProfit, 355);
  check('grossLoss 합(음수 유지)', out.grossLoss, -100);
  check('profitCount', out.profitCount, 3);
  check('lossCount', out.lossCount, 2);
  check('항등식: 이익+손실 = 총 실현손익', out.grossProfit + out.grossLoss, 255);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 0원 건 — 어느 건수에도 포함되지 않고, 합계는 영향 없음
// ════════════════════════════════════════════════════════════════════════════
{
  const out = splitRealizedPL([100, 0, -40, 0, 0]);
  check('0원은 이익 건수에서 제외', out.profitCount, 1);
  check('0원은 손실 건수에서 제외', out.lossCount, 1);
  check('0원 포함해도 이익 합 불변', out.grossProfit, 100);
  check('0원 포함해도 손실 합 불변', out.grossLoss, -40);
  check('건수 합(2) < 총 건수(5) 허용', out.profitCount + out.lossCount, 2);
  check('항등식은 0원 섞여도 성립', out.grossProfit + out.grossLoss, 60);
  // -0은 value > 0 / value < 0 어느 쪽도 아니므로 0과 동일 취급
  check('-0도 양쪽 모두 제외', splitRealizedPL([-0]), EMPTY_REALIZED_PL_BREAKDOWN);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 경계 — 빈 배열 / 전부 이익 / 전부 손실 / 비정상값 / 불변성
// ════════════════════════════════════════════════════════════════════════════
{
  check('빈 배열 → 0 분해', splitRealizedPL([]), EMPTY_REALIZED_PL_BREAKDOWN);

  const allProfit = splitRealizedPL([10, 20, 30]);
  check('전부 이익 → grossLoss 0', allProfit.grossLoss, 0);
  check('전부 이익 → lossCount 0', allProfit.lossCount, 0);

  const allLoss = splitRealizedPL([-10, -20]);
  check('전부 손실 → grossProfit 0', allLoss.grossProfit, 0);
  check('전부 손실 → profitCount 0', allLoss.profitCount, 0);

  const dirty = splitRealizedPL([100, NaN, Infinity, -50, -Infinity]);
  check('NaN/Infinity 제외 — 이익 합', dirty.grossProfit, 100);
  check('NaN/Infinity 제외 — 손실 합', dirty.grossLoss, -50);
  check('NaN/Infinity 제외 — 이익 건수', dirty.profitCount, 1);
  check('NaN/Infinity 제외 — 손실 건수', dirty.lossCount, 1);

  const input = [1, -2, 3];
  splitRealizedPL(input);
  check('입력 배열 불변', input, [1, -2, 3]);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 표기 행 — 라벨/부호/톤
// ════════════════════════════════════════════════════════════════════════════
{
  const rows = buildSoldPLBreakdownRows({ grossProfit: 1200, grossLoss: -300, profitCount: 4, lossCount: 2 }, fmt);
  check('행 2개', rows.length, 2);
  check('이익 행', rows[0], { label: '이익 4건', value: '+₩1,200', tone: 'profit' });
  check('손실 행 — 절댓값 + 음수부호', rows[1], { label: '손실 2건', value: '−₩300', tone: 'loss' });

  // 한쪽만 있어도 두 줄 모두 표시(0원 줄이 보여야 "손실 0건"임이 드러난다)
  const onlyProfit = buildSoldPLBreakdownRows({ grossProfit: 500, grossLoss: 0, profitCount: 1, lossCount: 0 }, fmt);
  check('손실 0건이어도 2행 유지', onlyProfit.length, 2);
  check('손실 0건 표기', onlyProfit[1], { label: '손실 0건', value: '−₩0', tone: 'loss' });

  // 매도 기록이 아예 없으면 카드는 기존 모습 그대로
  check('전부 0건 → 빈 배열(카드 원형 유지)', buildSoldPLBreakdownRows(EMPTY_REALIZED_PL_BREAKDOWN, fmt), []);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 골든값 — 41건 규모 픽스처의 절대값 고정 (실거래 데이터 아님, 합성 픽스처)
//    실계좌 값을 저장소에 넣지 않으면서 "이익 34건/손실 7건" 규모의 자릿수를 재현한다.
// ════════════════════════════════════════════════════════════════════════════
{
  // 41건의 건별 실현손익(원 단위). 이익 34건 / 손실 7건 / 0원 0건.
  const REALIZED_41: number[] = [
    850800, -2798000, 3204000, 11289600, 1620000, -1131000, 8964000, 2295000,
    6120000, -4396500, 1890000, 15300000, 742500, -892500, 5355000, 3672000,
    918000, -1683000, 2040000, 9180000, 1275000, 4590000, -2295000, 7140000,
    561000, 2652000, 1428000, -1122000, 3315000, 6885000, 918000, 2040000,
    12240000, 1530000, 3060000, 765000, 4335000, 1122000, 2550000, 1785000,
    918000,
  ];
  const out = splitRealizedPL(REALIZED_41);

  check('골든 — 총 건수 41', REALIZED_41.length, 41);
  check('골든 — 이익 건수 34', out.profitCount, 34);
  check('골든 — 손실 건수 7', out.lossCount, 7);
  check('골든 — 이익 합계', out.grossProfit, 132_549_900);
  check('골든 — 손실 합계', out.grossLoss, -14_318_000);
  check('골든 — 항등식(이익+손실=매도수익)', out.grossProfit + out.grossLoss, 118_231_900);
  check('골든 — 건수 합 = 총 건수(0원 없음)', out.profitCount + out.lossCount, REALIZED_41.length);

  const rows = buildSoldPLBreakdownRows(out, fmt);
  check('골든 — 이익 행 표기', rows[0], { label: '이익 34건', value: '+₩132,549,900', tone: 'profit' });
  check('골든 — 손실 행 표기', rows[1], { label: '손실 7건', value: '−₩14,318,000', tone: 'loss' });
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 항등식 무작위 검증 — 어떤 조합에서도 이익+손실 = 총합
// ════════════════════════════════════════════════════════════════════════════
{
  // 결정적 시퀀스(고정 시드 대체) — 부호/0/소수를 골고루 섞는다
  const values: number[] = [];
  for (let i = 0; i < 200; i++) {
    const v = ((i * 7919) % 401) - 200; // -200 ~ 200, 0 포함
    values.push(i % 13 === 0 ? 0 : v + (i % 5) * 0.25);
  }
  const total = values.reduce((s, v) => s + v, 0);
  const out: RealizedPLBreakdown = splitRealizedPL(values);
  const diff = Math.abs(out.grossProfit + out.grossLoss - total);
  check('200건 항등식 오차 < 1e-9', diff < 1e-9, true);
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n[soldPLBreakdownParity] ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  fails.forEach(f => console.error(f));
  process.exit(1);
}
