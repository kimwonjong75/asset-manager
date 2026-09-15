// 지식 인제스트 승인 큐 패널 (UI 전용)
// ---------------------------------------------------------------------------
// 로컬 DB/queue/knowledge-inbox.jsonl 을 불러와 후보를 검토·승인한다.
// 데이터/상태 로직은 hooks/useKnowledgeInbox 에 위임. 이 컴포넌트는 렌더만.
// 승인 전엔 어떤 후보도 신호로 활성화되지 않는다(면책 명시).
// Stage C: 버튼은 공용 Button(카드당 primary 1개), 오류·차단 사유는 danger(핑크)+CircleAlert.

import React, { useRef } from 'react';
import { CircleAlert, FolderOpen } from 'lucide-react';
import { useKnowledgeInbox } from '../../hooks/useKnowledgeInbox';
import Button from '../common/Button';
import type { IngestQueueEntry, KnowledgeClaim, KnowledgeRule } from '../../types/knowledge';

const CATEGORY_LABEL: Record<string, string> = {
  'market-regime': '시장국면', screening: '종목선정', 'entry-setup': '진입셋업',
  'entry-timing': '진입타이밍', 'exit-stoploss': '손절', 'exit-profit': '익절',
  'position-sizing': '베팅규모', psychology: '심리',
};
const DECAY_LABEL: Record<string, string> = {
  'risk-principle': '무감쇠·리스크원칙', 'evergreen-reference': '무감쇠·개념',
  'strategy-rule': '전략(12~24개월)', 'market-regime': '시장국면(2~8주)',
  'stock-comment': '종목코멘트(1~4주)', 'event-news': '뉴스(며칠~2주)',
};

function displayOf(entry: IngestQueueEntry): { title: string; tags: string[] } {
  if (entry.kind === 'claim') {
    const c = entry.candidate as KnowledgeClaim;
    return {
      title: c.statement,
      tags: [CATEGORY_LABEL[c.category] ?? c.category, DECAY_LABEL[c.decayClass] ?? c.decayClass],
    };
  }
  const r = entry.candidate as KnowledgeRule;
  return {
    title: r.title,
    tags: [CATEGORY_LABEL[r.ruleType] ?? r.ruleType, r.computability === 'signal' ? '신호' : '참고', r.action],
  };
}

// 신뢰도: high=ok(충족) / medium=warning(확인 필요) / low=중립
const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'bg-ok-soft text-ok',
  medium: 'bg-warning-soft text-warning',
  low: 'bg-surface-muted text-gray-300',
};

const KnowledgeInboxPanel: React.FC = () => {
  const {
    entries, fileName, error, importFromFile,
    approveClaim, approveRule, dismiss, clearAll, checkRule,
  } = useKnowledgeInbox();
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void importFromFile(f);
    e.target.value = ''; // 같은 파일 재선택 허용
  };

  return (
    <div>
      <p className="text-sm text-gray-300 mb-4">
        강의록에서 추출·검증된 <span className="text-gray-100 font-semibold">지식 후보</span>를 불러와 검토·승인합니다.
        승인한 항목만 구루 지식 DB에 반영되며, <span className="text-white">승인 전엔 어떤 신호도 활성화되지 않습니다.</span>
      </p>

      {/* 입력 방법 안내 */}
      <div className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2.5 mb-3 text-xs text-gray-400 leading-relaxed">
        <span className="text-gray-300 font-semibold">입력 방법</span><br />
        ① <span className="font-mono text-gray-200">DB/inbox/</span> 경로에 강의록 파일(.txt/.pdf)을 넣는다<br />
        ② 클로드코드에서 <span className="text-white">"최신 파일을 인제스트 해줘"</span> 라고 입력한다<br />
        ③ 생성된 큐 파일을 아래에서 불러와 검토·승인한다
      </div>

      {/* 불러오기 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          ref={fileRef}
          type="file"
          accept=".jsonl,.json,.txt"
          onChange={onPick}
          className="hidden"
        />
        <Button
          variant="secondary"
          icon={<FolderOpen className="h-4 w-4" />}
          onClick={() => fileRef.current?.click()}
        >
          큐 파일 불러오기
        </Button>
        <span className="text-xs text-gray-500 font-mono">DB/queue/knowledge-inbox.jsonl</span>
        {fileName && <span className="text-xs text-gray-400">· {fileName}</span>}
        {entries.length > 0 && (
          <Button variant="ghost" className="ml-auto" onClick={clearAll}>
            목록 비우기
          </Button>
        )}
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-1.5 bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger mb-3">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="bg-surface-muted rounded-lg px-4 py-6 text-center text-xs text-gray-500">
          불러온 승인 대기 후보가 없습니다. 위에서 큐 파일을 선택하세요.
          <br />
          (생성: <span className="font-mono">python scripts/ingest/validate_inbox.py</span> → triage 워크플로 → <span className="font-mono">triage_commit.py</span>)
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-gray-500">승인 대기 {entries.length}건</div>
          {entries.map(entry => {
            const { title, tags } = displayOf(entry);
            const promote = checkRule(entry);
            const canActivate = entry.kind === 'rule' && promote?.ok === true;
            return (
              <div key={entry.queueId} className="bg-surface-muted border border-border-subtle rounded-card p-4">
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-xs px-1.5 py-0.5 rounded shrink-0 bg-surface-elevated border border-border-subtle text-gray-200">
                    {entry.kind === 'rule' ? '규칙' : '주장'}
                  </span>
                  <p className="text-sm text-white flex-1">{title}</p>
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${CONFIDENCE_STYLE[entry.confidence] ?? CONFIDENCE_STYLE.low}`}>
                    {entry.confidence}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1 mb-2">
                  {tags.map(t => (
                    <span key={t} className="text-xs text-gray-300 bg-surface-elevated rounded px-1.5 py-0.5">{t}</span>
                  ))}
                  <span className="text-xs text-gray-400 bg-surface-elevated rounded px-1.5 py-0.5">
                    {entry.dedup === 'new' ? '신규' : entry.dedup}
                  </span>
                </div>

                {entry.reason && (
                  <p className="text-xs text-gray-400 mb-3 leading-relaxed">
                    <span className="text-gray-500">분류 사유: </span>{entry.reason}
                  </p>
                )}

                {/* 규칙 promote 차단 사유 */}
                {entry.kind === 'rule' && promote && !promote.ok && (
                  <div className="flex items-start gap-1.5 text-xs text-danger bg-danger-soft rounded-lg px-2 py-1.5 mb-3">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden="true" />
                    <span>신호 활성화 불가: {promote.blockers.join(' / ')}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {entry.kind === 'claim' ? (
                    <Button variant="primary" onClick={() => approveClaim(entry)}>
                      승인 (지식 추가)
                    </Button>
                  ) : (
                    <>
                      <Button variant="secondary" onClick={() => approveRule(entry, false)}>
                        초안으로 승인
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => approveRule(entry, true)}
                        disabled={!canActivate}
                        title={canActivate ? '' : '무결성 검사를 통과해야 신호로 활성화할 수 있습니다'}
                      >
                        신호로 활성화
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" onClick={() => dismiss(entry)}>
                    보류
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-500 mt-4 pt-3 border-t border-border-subtle">
        승인은 이 기기의 Google Drive 저장본(portfolio.json)에 반영됩니다. 보류는 목록에서만 제거하며 로컬 큐 파일은 그대로입니다.
      </p>
    </div>
  );
};

export default KnowledgeInboxPanel;
