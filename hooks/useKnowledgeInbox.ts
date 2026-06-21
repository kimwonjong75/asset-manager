// 지식 인제스트 승인 큐 훅 — 큐 파일 import + 승인/보류 (데이터 처리·상태)
// ---------------------------------------------------------------------------
// 로컬 DB/queue/knowledge-inbox.jsonl 을 파일 선택으로 불러와 후보를 검토.
// 승인 시 utils/knowledgeIngest.applyApproval 로 knowledgeBase를 갱신하고
// PortfolioContext.actions.updateKnowledgeBase 로 상태 반영 + Drive 자동 저장.
// (브라우저는 로컬 DB/ 폴더를 직접 못 읽으므로 파일 선택 import 방식)

import { useCallback, useMemo, useState } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import {
  parseIngestQueue, applyApproval, canPromoteRule,
} from '../utils/knowledgeIngest';
import type { IngestQueueEntry, KnowledgeRule, PromoteCheck } from '../types/knowledge';
import { createLogger } from '../utils/logger';

const logger = createLogger('useKnowledgeInbox');

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface UseKnowledgeInbox {
  entries: IngestQueueEntry[];
  fileName: string | null;
  error: string | null;
  importFromFile: (file: File) => Promise<void>;
  importFromText: (text: string, name?: string) => void;
  approveClaim: (entry: IngestQueueEntry) => void;
  approveRule: (entry: IngestQueueEntry, activateRuleAsSignal: boolean) => void;
  dismiss: (entry: IngestQueueEntry) => void;
  clearAll: () => void;
  checkRule: (entry: IngestQueueEntry) => PromoteCheck | null;
}

export function useKnowledgeInbox(): UseKnowledgeInbox {
  const { data, actions } = usePortfolio();
  const knowledgeBase = data.knowledgeBase;
  const [entries, setEntries] = useState<IngestQueueEntry[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importFromText = useCallback((text: string, name?: string) => {
    try {
      const parsed = parseIngestQueue(text);
      // 이미 DB에 같은 id로 존재하는 후보는 제외 (재import 중복 방지)
      const claimIds = new Set(knowledgeBase.claims.map(c => c.id));
      const ruleIds = new Set(knowledgeBase.rules.map(r => r.id));
      const fresh = parsed.filter(e =>
        e.kind === 'claim' ? !claimIds.has(e.candidate.id) : !ruleIds.has(e.candidate.id));
      setEntries(fresh);
      setFileName(name ?? null);
      if (parsed.length === 0) setError('큐에서 유효한 후보를 찾지 못했습니다.');
      else if (fresh.length === 0) setError('큐의 후보가 모두 이미 DB에 반영되어 있습니다.');
      else setError(null);
    } catch (e) {
      logger.error('큐 import 실패', e);
      setError('큐 파일을 읽지 못했습니다.');
    }
  }, [knowledgeBase]);

  const importFromFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      importFromText(text, file.name);
    } catch (e) {
      logger.error('파일 읽기 실패', e);
      setError('파일을 읽지 못했습니다.');
    }
  }, [importFromText]);

  const removeEntry = useCallback((queueId: string) => {
    setEntries(prev => prev.filter(e => e.queueId !== queueId));
  }, []);

  const approveClaim = useCallback((entry: IngestQueueEntry) => {
    const { kb } = applyApproval(knowledgeBase, entry, {}, todayStr());
    actions.updateKnowledgeBase(kb);
    removeEntry(entry.queueId);
  }, [knowledgeBase, actions, removeEntry]);

  const approveRule = useCallback((entry: IngestQueueEntry, activateRuleAsSignal: boolean) => {
    const { kb } = applyApproval(knowledgeBase, entry, { activateRuleAsSignal }, todayStr());
    actions.updateKnowledgeBase(kb);
    removeEntry(entry.queueId);
  }, [knowledgeBase, actions, removeEntry]);

  const dismiss = useCallback((entry: IngestQueueEntry) => {
    removeEntry(entry.queueId);
  }, [removeEntry]);

  const clearAll = useCallback(() => {
    setEntries([]);
    setFileName(null);
    setError(null);
  }, []);

  const checkRule = useCallback((entry: IngestQueueEntry): PromoteCheck | null => {
    if (entry.kind !== 'rule') return null;
    return canPromoteRule(entry.candidate as KnowledgeRule, knowledgeBase);
  }, [knowledgeBase]);

  return useMemo(() => ({
    entries, fileName, error,
    importFromFile, importFromText,
    approveClaim, approveRule, dismiss, clearAll, checkRule,
  }), [entries, fileName, error, importFromFile, importFromText, approveClaim, approveRule, dismiss, clearAll, checkRule]);
}
