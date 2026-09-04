// services/notifySyncService.ts
// ---------------------------------------------------------------------------
// 카카오톡 알림 GAS 웹앱과의 통신. `hooks/useKakaoNotify.ts`만 이 서비스를 호출한다
// (컴포넌트는 services/ 직접 호출 금지 — ESLint no-restricted-imports, CLAUDE.md).
//
// `Content-Type: text/plain`을 쓰는 이유: GAS 웹앱(`doPost`)은 CORS 프리플라이트(OPTIONS)에
// 커스텀 응답을 할 수 없어, `application/json`으로 보내면 브라우저가 자동으로 보내는 프리플라이트가
// 항상 실패한다. `text/plain`은 "simple request"로 분류되어 프리플라이트 자체가 생략되므로
// (GAS의 일반적 제약 — 이 저장소의 규약이 아니다) 이 방식으로 우회한다. 본문은 그대로 JSON 문자열이고
// GAS 쪽 `doPost`가 `e.postData.contents`를 `JSON.parse`한다(계획서 §6.1).
//
// 백엔드 Cloud Run과 달리 이 엔드포인트는 사용자가 직접 배포한 개인 GAS 웹앱 URL이라
// `constants/api.ts`의 중앙관리 대상이 아니다(사용자별로 다름 — hooks/useKakaoNotify가 localStorage에서 읽어 전달).

import { createLogger } from '../utils/logger';
import type { NotifyManifest } from '../utils/notifyManifest';

const log = createLogger('notifySyncService');

export interface GasSyncRequest { action: 'sync'; secret: string; manifest: NotifyManifest }
export interface GasTestRequest { action: 'test'; secret: string }
export interface GasStatusRequest { action: 'status'; secret: string }
export type GasRequestBody = GasSyncRequest | GasTestRequest | GasStatusRequest;

export interface GasSyncResponse {
  ok: boolean;
  receivedAt?: string;
  itemCount?: number;
  error?: string;
}

export interface GasTestResponse {
  ok: boolean;
  error?: string;
}

export interface GasLastRun {
  at: string;
  status: 'ok' | 'error';
  message?: string;
}

export interface GasStatusResponse {
  ok: boolean;
  lastRun?: GasLastRun | null;
  dailyCount?: number;
  kakaoConnected?: boolean;
  manifestItemCount?: number;
  manifestUpdatedAt?: string | null;
  error?: string;
}

/**
 * GAS 웹앱 `doPost`에 요청을 보내고 JSON으로 파싱한다.
 * 네트워크·파싱 실패는 그대로 throw — 호출부(`syncManifest`/`testConnection`/`fetchStatus`)가
 * try/catch로 잡아 `{ok:false, error}` 형태로 통일해 반환한다(CLAUDE.md: fallback 필수).
 */
export async function postToGas<T>(gasUrl: string, body: GasRequestBody): Promise<T> {
  const res = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`GAS 응답 오류 (${res.status}): ${rawText.slice(0, 200)}`);
  }
  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error(`GAS 응답을 해석할 수 없습니다: ${rawText.slice(0, 200)}`);
  }
}

export async function syncManifest(
  gasUrl: string,
  secret: string,
  manifest: NotifyManifest,
): Promise<GasSyncResponse> {
  try {
    return await postToGas<GasSyncResponse>(gasUrl, { action: 'sync', secret, manifest });
  } catch (e) {
    log.error('동기화 실패:', e);
    return { ok: false, error: e instanceof Error ? e.message : '동기화 요청에 실패했습니다.' };
  }
}

export async function testConnection(gasUrl: string, secret: string): Promise<GasTestResponse> {
  try {
    return await postToGas<GasTestResponse>(gasUrl, { action: 'test', secret });
  } catch (e) {
    log.error('연결 테스트 실패:', e);
    return { ok: false, error: e instanceof Error ? e.message : '연결 테스트에 실패했습니다.' };
  }
}

export async function fetchStatus(gasUrl: string, secret: string): Promise<GasStatusResponse> {
  try {
    return await postToGas<GasStatusResponse>(gasUrl, { action: 'status', secret });
  } catch (e) {
    log.error('상태 조회 실패:', e);
    return { ok: false, error: e instanceof Error ? e.message : '상태 조회에 실패했습니다.' };
  }
}
