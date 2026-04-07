/**
 * 중앙 상수/설정 파일
 * ─────────────────────────────────────────────────────────────
 * 프로젝트 전반에서 사용되는 매직 넘버, URL, 타이밍 값을 한 곳에 모은다.
 *
 * ⚠️ 이 파일은 새로 도입된 중앙화 파일이며, 기존 하드코딩 코드의 import 교체는
 *    별도 작업으로 진행한다. 새 코드 작성 시에는 반드시 이 파일에서 값을 가져올 것.
 *
 * 카테고리:
 *  1. API URLs
 *  2. 환율 (Exchange Rates)
 *  3. 가격/시장 데이터 호출 튜닝
 *  4. 캐시 TTL
 *  5. UI 타이밍 (메시지/포커스/blur)
 *  6. Storage 키
 *  7. OAuth (Google Drive)
 */

// ─────────────────────────────────────────────────────────────
// 1. API URLs
// ─────────────────────────────────────────────────────────────

/** Cloud Run 백엔드 베이스 URL (constants/api.ts와 동일 값 — 단계적 통합 예정) */
export const CLOUD_RUN_BASE_URL =
  'https://asset-manager-887842923289.asia-northeast3.run.app';

/** Google Drive REST API 베이스 */
export const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

/** Google Drive 멀티파트 업로드 베이스 */
export const GOOGLE_DRIVE_UPLOAD_BASE =
  'https://www.googleapis.com/upload/drive/v3';

/** Google Identity Services 스크립트 */
export const GOOGLE_GSI_CLIENT_URL = 'https://accounts.google.com/gsi/client';

/** Google OAuth 스코프 (Drive + 사용자 프로필) */
export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
].join(' ');

// ─────────────────────────────────────────────────────────────
// 2. 환율 기본값/Fallback
// ─────────────────────────────────────────────────────────────

/**
 * 환율 API 호출 실패 또는 비정상 값 수신 시 사용할 기본 환율.
 * - USD: 1 USD → KRW
 * - JPY: 1 JPY → KRW (100엔이 아닌 1엔 기준)
 *
 * 비정상 판정 임계값: USD < 100 이면 fallback 사용 (환율 데이터 손상 방지)
 */
export const DEFAULT_EXCHANGE_RATES = {
  USD: 1450,
  JPY: 9.5,
} as const;

/** 환율 값이 비정상으로 간주되는 하한 (USD 기준) */
export const EXCHANGE_RATE_SANITY_MIN_USD = 100;

/** priceService 내부 USD-KRW 변환 fallback (별도 값으로 관리되던 1400) */
export const PRICE_SERVICE_USD_KRW_FALLBACK = 1400;

// ─────────────────────────────────────────────────────────────
// 3. 가격/시장 데이터 호출 튜닝
// ─────────────────────────────────────────────────────────────

/** 가격 일괄 조회 시 한 번에 보낼 자산 개수 */
export const PRICE_FETCH_CHUNK_SIZE = 20;

/** 청크 사이 대기 시간 (rate limit 회피) */
export const PRICE_FETCH_CHUNK_DELAY_MS = 500;

/** Gemini 분석 요청 배치 크기 */
export const GEMINI_ANALYSIS_BATCH_SIZE = 10;

// ─────────────────────────────────────────────────────────────
// 4. 캐시 TTL
// ─────────────────────────────────────────────────────────────

/** 기술적 지표/금 프리미엄/과거 가격 캐시 TTL (10분) */
export const INDICATOR_CACHE_TTL_MS = 10 * 60 * 1000;

/** 페이지 가시성 변경 후 재조회 쿨다운 (10분) */
export const VISIBILITY_REFETCH_COOLDOWN_MS = 10 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// 5. UI 타이밍
// ─────────────────────────────────────────────────────────────

/** 성공/에러 메시지 자동 사라짐 시간 (기본) */
export const STATUS_MESSAGE_AUTO_DISMISS_MS = 3000;

/** 시장 데이터 로딩 메시지 자동 사라짐 (조금 더 길게 표시) */
export const MARKET_STATUS_MESSAGE_AUTO_DISMISS_MS = 5000;

/** 포커스 강조된 행이 자동 해제되는 시간 */
export const FOCUSED_ROW_AUTO_CLEAR_MS = 2500;

/** Combobox 등에서 onBlur 처리 지연 (클릭 우선 처리용) */
export const INPUT_BLUR_CLICK_DELAY_MS = 150;

/** 모달 오픈 시 input autofocus 지연 */
export const MODAL_AUTOFOCUS_DELAY_MS = 100;

// ─────────────────────────────────────────────────────────────
// 6. Storage 키
// ─────────────────────────────────────────────────────────────

/** localStorage에 저장되는 백엔드 발급 JWT 키 */
export const STORAGE_KEY_GOOGLE_DRIVE_JWT = 'google_drive_jwt';
