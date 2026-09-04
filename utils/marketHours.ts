// utils/marketHours.ts
// 장 시간 판정 — 순수 함수. **카카오톡 GAS 번들에 그대로 포함될 예정**(P5)이므로
// 브라우저 API(Date.now, Intl, toLocale*, window/document) 사용을 절대 금지한다.
// 모든 시간대 변환은 명시적 UTC 오프셋 산술로 한다: KST=UTC+9(DST 없음 상시),
// 미국 동부는 DST 규칙에 따라 UTC-4(EDT)/UTC-5(EST)를 오간다.
//
// **공휴일은 모델링하지 않는다** — 개장일 판정은 요일(월~금)만 본다. 명절·임시휴장 등은
// 이 모듈의 범위 밖이며, 신선도 게이트(`priceFreshness.ts`)가 다소 보수적으로(더 자주)
// 갱신을 트리거하는 방향으로만 어긋난다(휴장일을 개장으로 오판해도 안전측 — 손해는 API 호출 낭비뿐).
//
// US DST 규칙: 3월 둘째 일요일 02:00(EST, UTC-5=UTC 07:00) 시작 →
//              11월 첫째 일요일 02:00(EDT, UTC-4=UTC 06:00) 종료.

export type MarketId = 'KR' | 'US' | 'CRYPTO';

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const KST_OFFSET_MIN = 9 * 60;

function toMs(now: string | Date): number {
  return typeof now === 'string' ? new Date(now).getTime() : now.getTime();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' 조립 */
function dateStr(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * UTC epoch ms → "벽시계 트릭"으로 얻은 특정 시간대의 달력 필드.
 * `wallMs`는 실제 UTC 순간이 아니라 "그 시간대의 벽시계 시각을 UTC로 오독한 값"이다
 * (예: KST 벽시계 시각을 그대로 UTC getUTC*로 읽기 위해 +9h를 더한 값).
 */
interface WallParts { y: number; m: number; d: number; hh: number; mm: number; dow: number }
function wallParts(wallMs: number): WallParts {
  const dt = new Date(wallMs);
  return {
    y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
    hh: dt.getUTCHours(), mm: dt.getUTCMinutes(), dow: dt.getUTCDay(),
  };
}

/** UTC epoch ms → KST 벽시계 필드 */
function kstParts(ms: number): WallParts {
  return wallParts(ms + KST_OFFSET_MIN * MS_PER_MIN);
}

/** 특정 KST 날짜(y,m,d) 00:00의 UTC epoch ms */
function kstMidnightUtcMs(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d, 0, 0, 0) - KST_OFFSET_MIN * MS_PER_MIN;
}

/** 그 해의 "월(0-indexed)의 n번째 일요일" 일(day-of-month) */
function nthSundayDom(year: number, month0: number, nth: number): number {
  const dow = new Date(Date.UTC(year, month0, 1)).getUTCDay(); // 1일의 요일
  const firstSunday = 1 + ((7 - dow) % 7);
  return firstSunday + (nth - 1) * 7;
}

/** 주어진 ET 달력 날짜(y,m,d)가 서머타임(EDT) 기간인지 — 그 날짜 오후 기준(전이일 당일도 새 오프셋 적용) */
function isDaylightForEtDate(y: number, m: number, d: number): boolean {
  if (m < 3 || m > 11) return false;
  if (m > 3 && m < 11) return true;
  if (m === 3) return d >= nthSundayDom(y, 2, 2); // 3월 둘째 일요일부터
  return d < nthSundayDom(y, 10, 1); // 11월 첫째 일요일 전까지
}

/** ET 오프셋(분, UTC 기준 음수) — 주어진 UTC ms 순간의 서머타임 여부로 결정(연도만 근사 확인 후 날짜 재확인) */
function etOffsetMinAt(ms: number): number {
  const approx = new Date(ms);
  const y = approx.getUTCFullYear();
  const m = approx.getUTCMonth() + 1;
  const d = approx.getUTCDate();
  return isDaylightForEtDate(y, m, d) ? -4 * 60 : -5 * 60;
}

/** UTC epoch ms → ET 벽시계 필드(해당 순간의 DST 상태 기준) */
function etParts(ms: number): WallParts {
  return wallParts(ms + etOffsetMinAt(ms) * MS_PER_MIN);
}

/** KST 벽시계/ET 벽시계 필드 → 외부 노출용(설명 라벨 등에서 재사용) */
export function toKstParts(now: string | Date): { y: number; m: number; d: number; hh: number; mm: number; dow: number } {
  return kstParts(toMs(now));
}

// ── 개장 여부 ──────────────────────────────────────────────────────────────
export function isMarketOpen(market: MarketId, now: string | Date): boolean {
  const ms = toMs(now);
  if (market === 'CRYPTO') return true; // 24시간 상시 개장
  if (market === 'KR') {
    const k = kstParts(ms);
    if (k.dow === 0 || k.dow === 6) return false;
    const minutesOfDay = k.hh * 60 + k.mm;
    return minutesOfDay >= 9 * 60 && minutesOfDay < 15 * 60 + 30; // 09:00–15:30 KST
  }
  // US
  const e = etParts(ms);
  if (e.dow === 0 || e.dow === 6) return false;
  const minutesOfDay = e.hh * 60 + e.mm;
  return minutesOfDay >= 9 * 60 + 30 && minutesOfDay < 16 * 60; // 09:30–16:00 ET
}

// ── 정숙시간 (00:00–07:00 KST) ────────────────────────────────────────────
export function isQuietHours(now: string | Date): boolean {
  const k = kstParts(toMs(now));
  return k.hh >= 0 && k.hh < 7;
}

// ── 가장 최근(완료 또는 진행 중) 세션 날짜 ──────────────────────────────────
//
// KR: KST 달력일 기준. 오늘이 평일이고 09:00 KST 이후면 오늘, 아니면 직전 평일까지
//     거슬러 올라간다(주말 스킵).
// US: ET 달력일 기준으로 동일한 방식으로 판정한 날짜 문자열을 그대로 반환한다.
//     **ET 개장 순간(09:30 ET)을 KST로 환산해도 달력 날짜가 같다** — ET는 KST보다
//     13~14시간 느려서 개장 시각(오전)이 KST 저녁으로 밀려도 자정을 넘기지 않기 때문
//     (마감 16:00 ET만 다음날 KST 새벽으로 넘어간다 — `closeConfirmTime` 참고).
//     따라서 이 함수가 반환하는 날짜는 "ET 거래일"이자 곧 "KST 세션 시작일"이다.
// CRYPTO: 24시간 시장이라 자연스러운 마감이 없으므로, **09:00 KST를 하루 경계**로
//     정의한다(스펙 §5). 09:00 KST 이후면 오늘, 이전이면 어제.
export function lastSessionDate(market: MarketId, now: string | Date): string {
  const ms = toMs(now);

  if (market === 'CRYPTO') {
    const k = kstParts(ms);
    const minutesOfDay = k.hh * 60 + k.mm;
    if (minutesOfDay >= 9 * 60) return dateStr(k.y, k.m, k.d);
    const prevMidnightMs = kstMidnightUtcMs(k.y, k.m, k.d) - MS_PER_DAY; // 전날 00:00 KST
    const p = kstParts(prevMidnightMs);
    return dateStr(p.y, p.m, p.d);
  }

  if (market === 'KR') {
    // KST 벽시계 기준으로 날짜만 하루씩 빼며 평일 세션을 찾는다.
    let candidateWallMs = ms + KST_OFFSET_MIN * MS_PER_MIN; // 벽시계 ms(트릭)
    for (let offset = 0; offset < 10; offset++) {
      const p = wallParts(candidateWallMs);
      const isWeekend = p.dow === 0 || p.dow === 6;
      if (!isWeekend) {
        if (offset === 0) {
          const minutesOfDay = p.hh * 60 + p.mm;
          if (minutesOfDay >= 9 * 60) return dateStr(p.y, p.m, p.d);
        } else {
          return dateStr(p.y, p.m, p.d);
        }
      }
      candidateWallMs -= MS_PER_DAY;
    }
    // 도달 불가(안전망) — 10일 내 평일이 없을 수 없으므로 실질적으로 미도달
    const fallback = kstParts(ms);
    return dateStr(fallback.y, fallback.m, fallback.d);
  }

  // US: ET 벽시계 기준으로 동일한 방식(하루씩 빼며 평일 세션 탐색).
  const offsetNowMin = etOffsetMinAt(ms);
  let candidateWallMs = ms + offsetNowMin * MS_PER_MIN;
  for (let offset = 0; offset < 10; offset++) {
    const p = wallParts(candidateWallMs);
    const isWeekend = p.dow === 0 || p.dow === 6;
    if (!isWeekend) {
      if (offset === 0) {
        const minutesOfDay = p.hh * 60 + p.mm;
        if (minutesOfDay >= 9 * 60 + 30) return dateStr(p.y, p.m, p.d);
      } else {
        return dateStr(p.y, p.m, p.d);
      }
    }
    candidateWallMs -= MS_PER_DAY;
  }
  const fallback = etParts(ms);
  return dateStr(fallback.y, fallback.m, fallback.d);
}

// ── 마감 확정 시각 (해당 세션 날짜의 종가를 "확정"으로 간주하는 시각) ───────
//
// KR: 세션일 15:40 KST.
// US: 세션일(ET 달력일=KST 세션일, 위 설명 참고) 16:00 ET 마감 + 40분 = 16:40 ET.
//     ET→UTC 환산은 그 날짜의 DST 상태로 결정(전이일 당일도 새 오프셋 적용).
// CRYPTO: 다음 KST 일(day+1)의 09:00 KST — 스펙의 "코인 09:00 KST 일일 경계"를
//     세션 마감으로 해석: 세션일 D는 D 09:00 KST ~ D+1 09:00 KST 이며, D+1 09:00 KST에
//     그 세션이 "마감 확정"된다.
export function closeConfirmTime(market: MarketId, sessionDate: string): string {
  const [yStr, mStr, dStr] = sessionDate.split('-');
  const y = Number(yStr), m = Number(mStr), d = Number(dStr);

  if (market === 'KR') {
    const ms = kstMidnightUtcMs(y, m, d) + (15 * 60 + 40) * MS_PER_MIN;
    return new Date(ms).toISOString();
  }

  if (market === 'CRYPTO') {
    // D+1 계산 (달의 일수 경계는 UTC Date 생성자가 자동 이월 처리)
    const nextUtcNoon = Date.UTC(y, m - 1, d + 1, 12, 0, 0);
    const nd = new Date(nextUtcNoon);
    const ms = kstMidnightUtcMs(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate()) + 9 * MS_PER_HOUR;
    return new Date(ms).toISOString();
  }

  // US
  const daylight = isDaylightForEtDate(y, m, d);
  const etOffsetMin = daylight ? -4 * 60 : -5 * 60; // UTC = ET - etOffsetMin
  const wallMs = Date.UTC(y, m - 1, d, 16, 40, 0); // "16:40"을 UTC 필드에 그대로 심은 벽시계 값
  const ms = wallMs - etOffsetMin * MS_PER_MIN;
  return new Date(ms).toISOString();
}
