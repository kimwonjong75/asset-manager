// 지식 인제스트 승인 큐 패널 (UI 전용)
// ---------------------------------------------------------------------------
// 로컬 DB/queue/knowledge-inbox.jsonl 을 불러와 후보를 검토·승인한다.
// 데이터/상태 로직은 hooks/useKnowledgeInbox 에 위임. 이 컴포넌트는 렌더만.
// 승인 전엔 어떤 후보도 신호로 활성화되지 않는다(면책 명시).

import React, { useRef } from 'react';
import { useKnowledgeInbox } from '../../hooks/useKnowledgeInbox';
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

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'bg-emerald-500/15 text-emerald-300',
  medium: 'bg-amber-500/15 text-amber-300',
  low: 'bg-gray-500/15 text-gray-300',
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
        강의록에서 추출·검증된 <span className="text-cyan-400 font-semibold">지식 후보</span>를 불러와 검토·승인합니다.
        승인한 항목만 구루 지식 DB에 반영되며, <span className="text-white">승인 전엔 어떤 신호도 활성화되지 않습니다.</span>
      </p>

      {/* 입력 방법 안내 */}
      <div className="bg-gray-900/50 border border-gray-700 rounded-md px-3 py-2.5 mb-3 text-xs text-gray-400 leading-relaxed">
        <span className="text-gray-300 font-semibold">입력 방법</span><br />
        ① <span className="font-mono text-teal-300">DB/inbox/</span> 경로에 강의록 파일(.txt/.pdf)을 넣는다<br />
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
        <button
          onClick={() => fileRef.current?.click()}
          className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors"
        >
          큐 파일 불러오기
        </button>
        <span className="text-xs text-gray-500 font-mono">DB/queue/knowledge-inbox.jsonl</span>
        {fileName && <span className="text-xs text-gray-400">· {fileName}</span>}
        {entries.length > 0 && (
          <button onClick={clearAll} className="ml-auto text-xs text-gray-500 hover:text-gray-300">
            목록 비우기
          </button>
        )}
      </div>

      {error && (
        <div className="bg-gray-900/60 border border-gray-700 rounded-md px-3 py-2 text-xs text-amber-300 mb-3">
          {error}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="bg-gray-900/50 rounded-lg px-4 py-6 text-center text-xs text-gray-500">
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
              <div key={entry.queueId} className="bg-gray-900/60 border border-gray-700 rounded-lg p-4">
                <div className="flex items-start gap-2 mb-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${entry.kind === 'rule' ? 'bg-purple-500/15 text-purple-300' : 'bg-blue-500/15 text-blue-300'}`}>
                    {entry.kind === 'rule' ? '규칙' : '주장'}
                  </span>
                  <p className="text-sm text-white flex-1">{title}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${CONFIDENCE_STYLE[entry.confidence] ?? CONFIDENCE_STYLE.low}`}>
                    {entry.confidence}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1 mb-2">
                  {tags.map(t => (
                    <span key={t} className="text-[10px] text-gray-300 bg-gray-700/70 rounded px-1.5 py-0.5">{t}</span>
                  ))}
                  <span className="text-[10px] text-gray-400 bg-gray-800 rounded px-1.5 py-0.5">
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
                  <div className="text-[11px] text-rose-300 bg-rose-500/10 rounded px-2 py-1.5 mb-3">
                    ⛔ 신호 활성화 불가: {promote.blockers.join(' / ')}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {entry.kind === 'claim' ? (
                    <button
                      onClick={() => approveClaim(entry)}
                      className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                    >
                      승인 (지식 추가)
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => approveRule(entry, false)}
                        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
                      >
                        초안으로 승인
                      </button>
                      <button
                        onClick={() => approveRule(entry, true)}
                        disabled={!canActivate}
                        title={canActivate ? '' : '무결성 검사를 통과해야 신호로 활성화할 수 있습니다'}
                        className={`px-3 py-1.5 rounded text-white text-xs font-medium ${
                          canActivate ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        신호로 활성화
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => dismiss(entry)}
                    className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs"
                  >
                    보류
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-gray-600 mt-4 pt-3 border-t border-gray-700/60">
        승인은 이 기기의 Google Drive 저장본(portfolio.json)에 반영됩니다. 보류는 목록에서만 제거하며 로컬 큐 파일은 그대로입니다.
      </p>
    </div>
  );
};

export default KnowledgeInboxPanel;
