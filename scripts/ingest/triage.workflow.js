export const meta = {
  name: 'knowledge-triage',
  description: '강의록 추출본을 지식 DB 후보(claim/rule)로 triage — 중복판정·스키마매핑·검증',
  whenToUse: '주간 강의록을 DB/staging/extracted 로 검증·추출한 뒤, 정제 후보를 승인 큐로 만들 때',
  phases: [
    { title: '색인', detail: '기존 claim/rule 요약 인덱스 작성 (중복판정 기준)' },
    { title: '추출', detail: '강의록을 원칙/심리/전략/참고·노이즈 4버킷으로 병렬 추출' },
    { title: '검증', detail: '후보별 중복판정 + 앱 스키마 매핑 + 큐/거부 판정(적대적)' },
    { title: '통합', detail: '후보 간(sibling) 중복 병합 + 큐레이션 정책 위반 제외' },
  ],
}

// 입력: args = { sourceId, sourceDate, extractedRel } (문자열로 와도 파싱)
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const sourceId = A.sourceId
const sourceDate = A.sourceDate
const extractedRel = A.extractedRel
if (!sourceId || !extractedRel) {
  throw new Error('args.sourceId 와 args.extractedRel 필요 (받은 args: ' + JSON.stringify(args) + ')')
}

const LEGACY = 'constants/knowledgeBase.legacy.ts'
const CURATED = 'constants/knowledgeBase.ts'

// 앱 스키마 enum (types/knowledge.ts 와 동기) — 후보가 곧 최종 스키마라 promote=플래그플립
const ENUMS = `
category/ruleType: market-regime | screening | entry-setup | entry-timing | exit-stoploss | exit-profit | position-sizing | psychology
decayClass: risk-principle(무감쇠) | evergreen-reference(무감쇠) | strategy-rule | market-regime | stock-comment | event-news
authorityTier: kang-direct-principle(강환국 직접원칙) | kang-recommendation | kang-introduced-guru(강환국이 소개한 타구루) | external-guru | ai-inference
guru: kang-hwanguk | kullamagi | oneil | minervini | weinstein | darvas | livermore | frohlich | russo | breitstein | generic
confidence: strong | qualified | optional | author-opinion
computability: signal | advisory
action: buy-watch | buy-setup | sell-warning | risk-sizing | regime-filter | review
구현된 지표(signal 규칙은 이것만 사용 가능): rsi14, climaxFlags, distributionCount, volumeRatio50, priceToMa20Pct, priceToMa60Pct, priceToMa150Pct, pctBelow52wHigh, maCompression, assetTrendRegime, priceCrossAboveMa20Days
미구현 지표(쓰면 signal 불가 → advisory): rsRank, marketRegime, gapPct, ma65, allTimeHigh, swingLow, priceToMa10Pct
`.trim()

// 큐레이션 정책(사용자 확정, knowledgeBase.legacy.ts) — 위반 후보는 큐 제외
const CURATION_POLICY =
  '한국 개인투자자가 실행 가능한 durable 지식만 큐에 올린다. 제외 대상: ' +
  '①미국 소형주 숏 ②분봉(인트라데이 5·30·60분봉) EP·진입 타이밍 ③시점성 종목콜.'

// ── 색인: 기존 지식 요약 (중복판정 기준) ─────────────────────────────────────
const INDEX_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['claim', 'rule'] },
          category: { type: 'string' },
          gist: { type: 'string', description: '핵심 1줄 요약(한국어)' },
        },
        required: ['id', 'kind', 'gist'],
      },
    },
  },
  required: ['entries'],
}

const index = await agent(
  `${LEGACY} 와 ${CURATED} 를 읽고, 이미 DB에 존재하는 모든 지식(claim 50개 내외 + 큐레이션 rule)을 ` +
  `id·kind·category·핵심1줄요약(gist) 으로 인덱싱하라. 이 인덱스는 새 후보의 "이미 있는 지식인가" 판정 기준이 된다. ` +
  `statement 전문이 아니라 의미를 짧게 요약하라.`,
  { schema: INDEX_SCHEMA, phase: '색인', label: 'index:existing' },
)
const existingIndex = (index?.entries ?? [])
const indexText = existingIndex.map(e => `- ${e.id} [${e.kind}/${e.category ?? ''}] ${e.gist}`).join('\n')
log(`기존 지식 ${existingIndex.length}개 인덱싱 완료`)

// ── 추출: 4버킷 병렬 ─────────────────────────────────────────────────────────
const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          statement: { type: 'string', description: '자연어 주장/전략 한 문장(한국어)' },
          bucket: { type: 'string', enum: ['principle', 'psychology', 'strategy', 'reference', 'noise'] },
          sourceSpan: { type: 'string', description: '근거가 된 원문 한 구절(짧게)' },
          proposedCategory: { type: 'string' },
        },
        required: ['statement', 'bucket'],
      },
    },
  },
  required: ['items'],
}

const BUCKETS = [
  { key: '원칙', desc: '리스크/자금관리/손절 등 시간 무관 durable 원칙 (1%룰, 손절규율, 변동성별 손절폭 등)' },
  { key: '심리', desc: '행동/심리/메타 교훈 (과잉확신, 수익목표의 위험, 복기 습관, 물타기 금지 심리 등)' },
  { key: '전략', desc: '한국 개인투자자가 실행 가능한 매매 전략 (진입/청산 셋업·타이밍). 미국 소형주 숏 등 비실행은 제외' },
  { key: '참고노이즈', desc: '비실행 참고(교양: 소형주 숏/Broken숏 등 본인도 개인엔 비추천) + 순수 일화/스토리(노이즈)' },
]

const buckets = await parallel(BUCKETS.map(b => () =>
  agent(
    `${extractedRel} 를 읽어라(강환국 강의 전사본). 이 중 "${b.key}" 버킷에 해당하는 항목만 추출하라: ${b.desc}. ` +
    `각 항목은 한 문장의 자연어 statement + bucket + 근거 원문구절(sourceSpan) 으로. ` +
    `STT 오류는 의미로 보정. 같은 의미 반복은 1개로 합쳐라. 해당 버킷에 없으면 빈 배열.`,
    { schema: ITEM_SCHEMA, phase: '추출', label: `추출:${b.key}` },
  ),
))
const items = buckets.filter(Boolean).flatMap(r => r.items ?? [])
log(`후보 문장 ${items.length}개 추출 (4버킷)`)

// ── 검증: 후보별 중복판정 + 스키마 매핑 + 큐/거부 판정 ───────────────────────
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['queue', 'reject'] },
    kind: { type: 'string', enum: ['claim', 'rule'] },
    dedup: { type: 'string', description: "'new' | 'duplicate-of:<id>' | 'refines:<id>'" },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string', description: '초보가 읽을 분류 사유(한국어, 1~2문장)' },
    rejectStatement: { type: 'string', description: 'reject일 때 거부 로그에 남길 문장' },
    candidate: {
      type: 'object',
      description: 'queue일 때만. KnowledgeClaim 또는 KnowledgeRule 최종 스키마 그대로.',
      additionalProperties: true,
    },
  },
  required: ['decision', 'kind', 'dedup', 'reason'],
}

const verdicts = await pipeline(items, (item) =>
  agent(
    `다음 후보를 판정하라.\n\n` +
    `후보: "${item.statement}"\n버킷: ${item.bucket}\n근거: ${item.sourceSpan ?? ''}\n\n` +
    `[기존 지식 인덱스]\n${indexText}\n\n` +
    `[앱 스키마 enum]\n${ENUMS}\n\n` +
    `판정 규칙:\n` +
    `1) 기존 인덱스에 의미가 이미 있으면 decision='reject', dedup='duplicate-of:<id>' (가장 안전한 기본값).\n` +
    `2) bucket='noise'면 reject. bucket='reference'(비실행 참고)는 reject 하되 dedup='new', reason에 "비실행 참고" 명시.\n` +
    `2.5) 큐레이션 정책 위반은 reject. 정책: ${CURATION_POLICY} 특히 인트라데이 분봉 진입(분봉 EP)에 의존하면 reject(reason에 "정책상 분봉 EP 제외").\n` +
    `3) 진짜 새롭고 큐에 올릴 가치가 있으면 decision='queue'. 4기준 모두 충족해야 함: ` +
    `(a)신뢰도 high (b)스키마에 깔끔히 매핑 (c)근접중복 아님 (d)분류사유 완비. 하나라도 애매하면 reject.\n` +
    `4) queue면 candidate를 최종 스키마로 작성:\n` +
    `   - claim: { id(kebab-슬러그), sourceId:'${sourceId}', sourceDate:'${sourceDate}', statement, category, decayClass, ` +
    `authorityTier, guru, confidence, verification:{sourceVerified:true,factVerified:false,dataVerified:false,backtestVerified:false,userApproved:false,rejected:false}, tags:['pending-ingest', ...] }\n` +
    `   - rule: { id('rule-'+슬러그), claimIds:[기존 인덱스의 실제 claim id], title, ruleType, computability, action, ` +
    `status:'draft', requiredMetrics:[], verification:{...userApproved:false...}, riskPolicy? }\n` +
    `   주의: computability='signal' 규칙은 requiredMetrics가 "구현된 지표"여야 한다. 미구현 지표가 필요하면 computability='advisory'로.\n` +
    `5) 확신 없으면 reject. 미검증이 신호가 되는 것보다 누락이 안전하다.`,
    { schema: VERDICT_SCHEMA, phase: '검증', label: `검증:${item.statement.slice(0, 14)}` },
  ),
)

const ok = verdicts.filter(Boolean)
const rawQueue = ok.filter(v => v.decision === 'queue' && v.candidate)
  .map(v => ({ kind: v.kind, candidate: v.candidate, reason: v.reason, dedup: v.dedup, confidence: v.confidence ?? 'medium' }))
const baseRejected = ok.filter(v => v.decision !== 'queue' || !v.candidate)
  .map(v => ({ kind: v.kind, statement: v.rejectStatement ?? '', bucket: v.dedup?.startsWith('duplicate') ? 'duplicate' : 'rejected', reason: v.reason, dedup: v.dedup }))
log(`1차 판정 — 큐 후보 ${rawQueue.length} / 거부 ${baseRejected.length}`)

// ── 통합: 검증 에이전트가 독립 실행이라 못 거른 (a)후보 간 중복 (b)정책 위반을 최종 정리 ──
const CONSOLIDATE_SCHEMA = {
  type: 'object',
  properties: {
    keep: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['claim', 'rule'] },
          candidate: { type: 'object', additionalProperties: true },
          reason: { type: 'string' },
          dedup: { type: 'string' },
          confidence: { type: 'string' },
        },
        required: ['kind', 'candidate'],
      },
    },
    dropped: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          statement: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['id', 'reason'],
      },
    },
  },
  required: ['keep', 'dropped'],
}

let queue = rawQueue
let dropped = []
if (rawQueue.length > 1) {
  const con = await agent(
    `너는 통합·정책 검증 단계다. 아래 ${rawQueue.length}개 큐 후보를 최종 정리하라.\n\n` +
    `[후보 목록(JSON)]\n${JSON.stringify(rawQueue, null, 1)}\n\n` +
    `규칙:\n` +
    `1) 후보 간(sibling) 중복: 서로 같은 의미면 더 완전한 것 1개만 keep(태그는 union), 나머지는 dropped(reason="<keep id>와 중복 병합").\n` +
    `2) 큐레이션 정책 위반 제외: ${CURATION_POLICY} 인트라데이 분봉 진입 의존 후보는 dropped(reason="정책상 분봉 EP 제외").\n` +
    `3) 나머지는 keep. candidate 객체는 원본 그대로(병합 keep은 tags만 union 허용). 절대 새 후보 창작 금지.\n` +
    `4) keep + dropped 의 id 총수는 입력 ${rawQueue.length}개와 정확히 일치해야 한다(누락 금지).`,
    { schema: CONSOLIDATE_SCHEMA, phase: '통합', label: '통합:sibling-dedup+정책' },
  )
  if (con?.keep?.length) {
    queue = con.keep.map(k => ({ confidence: 'medium', dedup: 'new', reason: '', ...k }))
    dropped = con.dropped ?? []
  }
}

const rejected = baseRejected.concat(
  dropped.map(d => ({ kind: 'claim', statement: d.statement ?? '', bucket: 'consolidated-drop', reason: d.reason, dedup: '' })),
)
log(`통합 완료 — 최종 큐 ${queue.length} / 거부 ${rejected.length} (병합·정책제외 ${dropped.length})`)
return { sourceId, sourceDate, queue, rejected }
