// utils/replayExport.ts
// 검증 기록(판정 + 사례) 내보내기/가져오기 — 순수 직렬화/파싱.
// localStorage가 유일 저장소라 캐시 삭제·기기 변경 시 유실 위험 → JSON 파일 백업/복원 경로 제공.
// (Drive 동기화는 1차 범위 밖. 파일 export/import는 자기완결적·저위험이라 우선 채택.)
// 검증은 기존 안전 파서(parseVerdicts/parseCases) 재사용 — 깨진 항목은 폐기(부분 성공).

import { parseVerdicts } from './replayVerdicts';
import { parseCases } from './replayCases';
import type { SignalVerdict, VerificationCase } from '../types/signalReplay';

export const REPLAY_EXPORT_SCHEMA = 'asset-manager-replay-export';
export const REPLAY_EXPORT_VERSION = 1;

export interface ReplayExportBundle {
  schema: typeof REPLAY_EXPORT_SCHEMA;
  version: typeof REPLAY_EXPORT_VERSION;
  exportedAt: string;
  verdicts: SignalVerdict[];
  cases: VerificationCase[];
}

export function buildReplayExport(
  verdicts: SignalVerdict[], cases: VerificationCase[], exportedAt: string,
): ReplayExportBundle {
  return { schema: REPLAY_EXPORT_SCHEMA, version: REPLAY_EXPORT_VERSION, exportedAt, verdicts, cases };
}

export function serializeReplayExport(bundle: ReplayExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/**
 * 내보낸 번들 텍스트 → { verdicts, cases }. 스키마 불일치·깨진 JSON·잘못된 항목은 안전하게 폐기.
 * verdicts/cases 각각을 기존 파서로 재검증(JSON.stringify로 위임 — 검증 로직 단일 소스 유지).
 */
export function parseReplayExport(text: string | null): { verdicts: SignalVerdict[]; cases: VerificationCase[] } {
  try {
    const obj = JSON.parse(text ?? '');
    const verdicts = parseVerdicts(JSON.stringify(obj?.verdicts ?? []));
    const cases = parseCases(JSON.stringify(obj?.cases ?? []));
    return { verdicts, cases };
  } catch {
    return { verdicts: [], cases: [] };
  }
}
