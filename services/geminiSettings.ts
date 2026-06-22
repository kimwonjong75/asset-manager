// Gemini BYOK(Bring Your Own Key) 설정
// =====================================
// 사용자가 직접 입력한 자기 Gemini API 키와 선택 모델을 관리한다.
// - 키/모델은 이 브라우저의 localStorage에만 저장된다.
// - ⚠️ 절대 빌드 env / Google Drive 동기화 payload(useGoogleDriveSync.exportData)에 포함하지 말 것.
//   (exportData는 명시된 필드만 직렬화하므로, 아래 전용 키는 동기화에서 자동 제외된다.)

import { createLogger } from '../utils/logger';

const log = createLogger('GeminiSettings');

const KEY_STORAGE = 'asset-manager-gemini-api-key-v1';
const MODEL_STORAGE = 'asset-manager-gemini-model-v1';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export function getGeminiApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setGeminiApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch (e) {
    log.error('Failed to persist API key', e);
  }
}

export function getGeminiModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE) || DEFAULT_GEMINI_MODEL;
  } catch {
    return DEFAULT_GEMINI_MODEL;
  }
}

export function setGeminiModel(model: string): void {
  try {
    localStorage.setItem(MODEL_STORAGE, model || DEFAULT_GEMINI_MODEL);
  } catch (e) {
    log.error('Failed to persist model', e);
  }
}

export interface GeminiModelInfo {
  id: string;
  displayName: string;
}

interface RawModel {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

interface ModelsResponse {
  models?: RawModel[];
}

/**
 * 입력한 키로 실제 사용 가능한 모델 목록을 조회한다.
 * `generateContent`를 지원하는(=채팅/생성 가능) 모델만 반환 → 임베딩/이미지 모델 제외.
 * 키가 유효하지 않으면 throw.
 */
export async function fetchAvailableModels(apiKey: string): Promise<GeminiModelInfo[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  if (!res.ok) {
    throw new Error(`모델 목록 조회 실패 (${res.status})`);
  }
  const data = (await res.json()) as ModelsResponse;
  const models = data.models ?? [];
  return models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => {
      const id = (m.name ?? '').replace(/^models\//, '');
      return { id, displayName: m.displayName || id };
    })
    .filter((m) => m.id.length > 0);
}
