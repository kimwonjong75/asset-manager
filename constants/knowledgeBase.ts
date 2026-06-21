// 투자 구루 지식 베이스 (v2) — 시드 데이터 (Google Drive JSON으로 병합·동기화될 초기값)
// ---------------------------------------------------------------------------
// 전체 마이그레이션: 레거시 원본(knowledgeBase.legacy.ts)을 migrateLegacyEntries로 v2(claims/rules)로 변환.
// + 조건식(typed condition)이 있는 핵심 규칙은 CURATED_RULES로 덮어쓴다(자동 변환본보다 우선).
// 큐레이션 원칙: 한국 실행가능 durable만 / 강환국 authorityTier 가중 / 미검증은 신호 자동활성 차단(게이트).
// 점수·게이트: utils/knowledgeScoring. 변환 규칙: utils/migrateKnowledge.
// (legacy 의존은 전환기 한정 — 큐레이션 규칙이 자동본을 충분히 대체하면 legacy 삭제 예정)

import type {
  KnowledgeBase, KnowledgeSource, KnowledgeRule, KnowledgeJournalEntry, VerificationFlags,
} from '../types/knowledge';
import { EMPTY_VERIFICATION } from '../types/knowledge';
import { KNOWLEDGE_ENTRIES as LEGACY_ENTRIES } from './knowledgeBase.legacy';
import { migrateLegacyEntries } from '../utils/migrateKnowledge';

const INGESTED = '2026-06-21';
const vf = (p: Partial<VerificationFlags>): VerificationFlags => ({ ...EMPTY_VERIFICATION, ...p });

// ── 1. 원문 보관함 ─────────────────────────────────────────────────────────
export const KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  {
    id: '260610_what-when',
    title: '무엇을 언제 사야하나 — 돌파매매 족보 + 1.7만 백테스트',
    author: '강환국', sourceDate: '2026-06-10', ingestedAt: INGESTED,
    sourceType: 'lecture-transcript',
    originPath: 'C:\\Users\\beari\\Downloads\\260610_ 무엇을 언제 사야하나.txt',
    priorityProfile: 'khg-primary',
    note: 'CANSLIM(오닐)·돌파 계보(리버모어·다바스·와인스타인·미너비니)+쿨라매기+강환국 현대화. STT 오류 다수.',
  },
  {
    id: '260620_market-wizards',
    title: '시장의 마법사 특집 — 포지션 사이징/손절/심리',
    author: '강환국', sourceDate: '2026-06-20', ingestedAt: INGESTED,
    sourceType: 'lecture-transcript',
    originPath: 'C:\\Users\\beari\\Downloads\\260620_주간 투자전략_ 시장의 마법사 특집.txt',
    priorityProfile: 'khg-primary',
    note: 'Jack Schwager "Market Wizards" 시리즈(실제 6권+요약본). 트레이더명 교정 반영.',
  },
];

// ── 2~3. 전체 마이그레이션 (레거시 → v2 claims/rules) ──────────────────────
const migrated = migrateLegacyEntries(LEGACY_ENTRIES);

// 조건식(typed condition)·지표가 정의된 핵심 규칙 — 자동 변환본(rule-<id>)을 덮어쓴다.
const CURATED_RULES: KnowledgeRule[] = [
  {
    id: 'rule-position-sizing-calc',
    claimIds: ['risk-1pct-per-trade', 'position-size-from-stop'],
    title: '리스크 기반 포지션 사이징 계산기',
    ruleType: 'position-sizing', computability: 'advisory', action: 'risk-sizing',
    status: 'active', requiredMetrics: [],
    riskPolicy: '최대매수액 = (총자산 × 허용손실%) / 손절폭%. 1회 손실 한도 총자산 1%.',
    verification: vf({ sourceVerified: true, factVerified: true, dataVerified: true, userApproved: true }),
    note: '지표 의존 없음(사용자 입력). 최우선 구현 대상 — advisory라 신호 게이트 무관.',
  },
  {
    id: 'rule-ma-pullback-entry',
    claimIds: ['ma-pullback-entry', 'rs-90-screening'],
    title: '이평선 눌림목 진입 후보',
    ruleType: 'entry-setup', computability: 'signal', action: 'buy-setup',
    condition: {
      all: [
        { metric: 'rsRank', operator: '>=', value: 90 },
        { metric: 'priceToMa20Pct', operator: 'between', value: [-2, 3] },
        { metric: 'marketRegime', operator: 'in', value: ['green', 'neutral'] },
      ],
    },
    mappedSignalKey: 'MA_PULLBACK_ENTRY', status: 'draft',
    requiredMetrics: ['rsRank', 'priceToMa20Pct', 'marketRegime'],
    verification: vf({ sourceVerified: true, factVerified: true }),
    note: 'rsRank/priceToMa20Pct/marketRegime 앱 미구현 → 구현+승인 후 active.',
  },
  {
    id: 'rule-rs-90-screening',
    claimIds: ['rs-90-screening'],
    title: 'RS 90+ 리더 종목 필터',
    ruleType: 'screening', computability: 'signal', action: 'buy-watch',
    condition: { all: [{ metric: 'rsRank', operator: '>=', value: 90 }] },
    mappedSignalKey: 'RS_LEADER', status: 'draft',
    requiredMetrics: ['rsRank'],
    verification: vf({ sourceVerified: true, factVerified: true }),
    note: 'rsRank(백분위 RS) 신규 지표 필요.',
  },
  {
    id: 'rule-climax-top-sell',
    claimIds: ['climax-top-sell'],
    title: '클라이맥스 톱 과열 매도 경고',
    ruleType: 'exit-profit', computability: 'signal', action: 'sell-warning',
    condition: { all: [{ metric: 'climaxFlags', operator: '>=', value: 2 }] },
    mappedSignalKey: 'climax-top', status: 'active',
    requiredMetrics: ['climaxFlags'],
    verification: vf({ sourceVerified: true, factVerified: true, dataVerified: true }),
    note: '앱 기존 climax-top 신호와 연결(dataVerified) → 활성. 게이트 통과 예시.',
  },
  {
    // self-contained 지표만 사용하는 첫 buy-side 신호 (Guru Signal Engine 평가 대상).
    // 엄격판 rule-ma-pullback-entry(rsRank≥90 전제)는 rsRank 구현까지 차단 유지 — 이 규칙은 RS 선별을 뺀 약화판.
    id: 'rule-ma20-pullback-watch',
    claimIds: ['ma-pullback-entry'],
    title: 'MA20 눌림목 관찰 (추세 상승 중 단기 되돌림)',
    ruleType: 'entry-setup', computability: 'signal', action: 'buy-watch',
    condition: {
      all: [
        { metric: 'assetTrendRegime', operator: '=', value: 'uptrend' },
        { metric: 'priceToMa20Pct', operator: 'between', value: [-3, 3] },
        { metric: 'distributionCount', operator: '<=', value: 4 }, // 매물 출회 과다(토핑) 제외
      ],
    },
    mappedSignalKey: 'MA20_PULLBACK_WATCH', status: 'active',
    requiredMetrics: ['assetTrendRegime', 'priceToMa20Pct', 'distributionCount'],
    riskPolicy: 'MA20 이탈 후 1~2일 내 회복 실패 또는 직전 저점 이탈 시 무효',
    verification: vf({ sourceVerified: true, factVerified: true, userApproved: true }),
    note: '근거 claim(ma-pullback-entry)은 "RS 높은 종목" 전제이나, rsRank(시장 유니버스 백분위) 미구현으로 본 규칙은 RS 선별을 뺀 약화판(관찰 후보, buy-watch). 지표는 self-contained(assetTrendRegime·priceToMa20Pct, 라이브 priceOriginal 기준). distribution 과다 제외로 토핑 회피. 사용자 승인으로 활성. rsRank 구현 시 엄격판으로 승격 검토.',
  },
  {
    // 신고가 근처 돌파 관찰 — self-contained. 근거: 신고가 돌파 매수 + 박스권 돌파 + 거래량 동반.
    id: 'rule-near-high-breakout-watch',
    claimIds: ['all-time-high-breakout', 'box-breakout-entry', 'volume-confirms-advance'],
    title: '신고가 근접 돌파 관찰 (거래량 동반)',
    ruleType: 'entry-timing', computability: 'signal', action: 'buy-watch',
    condition: {
      all: [
        { metric: 'assetTrendRegime', operator: '=', value: 'uptrend' },
        { metric: 'pctBelow52wHigh', operator: '<=', value: 5 },  // 52주 고점 5% 이내(신고가 갱신=음수 포함)
        { metric: 'volumeRatio50', operator: '>=', value: 1.2 },  // 거래량 동반(오닐: 상승은 거래량 확인)
        { metric: 'climaxFlags', operator: '<', value: 2 },       // 과열 블로우오프 톱 제외
      ],
    },
    mappedSignalKey: 'NEAR_HIGH_BREAKOUT_WATCH', status: 'active',
    requiredMetrics: ['assetTrendRegime', 'pctBelow52wHigh', 'volumeRatio50', 'climaxFlags'],
    riskPolicy: '돌파 실패로 되돌림(직전 박스권/돌파가 아래 마감) 시 무효',
    verification: vf({ sourceVerified: true, factVerified: true, userApproved: true }),
    note: 'pctBelow52wHigh<=5는 신고가 갱신(지표 음수)을 포함하도록 상한만 둠. 거래량(volumeRatio50) 미수신 종목은 null→미발화(안전). climax 위험은 제외. RS 선별은 rsRank 구현까지 미적용(관찰 후보).',
  },
  {
    // MA20 재돌파(복귀) 관찰 — claim ma-reclaim-entry가 "기준 이평선 20일 추천"이라 MA20 사용(150 아님).
    id: 'rule-ma20-reclaim-watch',
    claimIds: ['ma-reclaim-entry'],
    title: 'MA20 재돌파(복귀) 관찰',
    ruleType: 'entry-setup', computability: 'signal', action: 'buy-watch',
    condition: {
      all: [
        { metric: 'assetTrendRegime', operator: 'in', value: ['neutral', 'uptrend'] },
        { metric: 'priceCrossAboveMa20Days', operator: 'between', value: [0, 5] }, // 최근 5거래일 내 MA20 위로 복귀
        { metric: 'distributionCount', operator: '<=', value: 4 },
      ],
    },
    mappedSignalKey: 'MA20_RECLAIM_WATCH', status: 'active',
    requiredMetrics: ['assetTrendRegime', 'priceCrossAboveMa20Days', 'distributionCount'],
    riskPolicy: '재돌파 후 다시 MA20 아래로 마감 또는 직전 저점 이탈 시 무효',
    verification: vf({ sourceVerified: true, factVerified: true, userApproved: true }),
    note: '근거 claim(ma-reclaim-entry): 주가가 이평선 아래로 떨어졌다 복귀 시 매수, 기준 20일선 추천. priceCrossAboveMa20Days=재돌파 경과 거래일(당일 0, 현재 MA20 아래면 null→미발화). 횡보 후 복귀 종목(neutral 허용). RS 선별 미적용(관찰 후보).',
  },
];

const curatedIds = new Set(CURATED_RULES.map(r => r.id));

export const KNOWLEDGE_CLAIMS = migrated.claims;
export const KNOWLEDGE_RULES: KnowledgeRule[] = [
  ...migrated.rules.filter(r => !curatedIds.has(r.id)),
  ...CURATED_RULES,
];
export const KNOWLEDGE_JOURNAL: KnowledgeJournalEntry[] = [];

export const SEED_KNOWLEDGE_BASE: KnowledgeBase = {
  version: 2,
  sources: KNOWLEDGE_SOURCES,
  claims: KNOWLEDGE_CLAIMS,
  rules: KNOWLEDGE_RULES,
  journal: KNOWLEDGE_JOURNAL,
  lastUpdated: INGESTED,
};

// ── 지식 근거 접근자 ────────────────────────────────────────────────────────
// 포지션 사이징 계산기(utils/positionSizing.ts) UI가 근거 규칙·주장을 표시할 때 사용.
// 규칙/주장 데이터를 컴포넌트에 흩뿌리지 않도록 knowledge 모듈에서 단일 조회 제공.
export const POSITION_SIZING_RULE_ID = 'rule-position-sizing-calc';

export interface KnowledgeBasis {
  title: string;
  riskPolicy?: string;
  claims: string[]; // 근거 claim들의 자연어 statement
}

export function getPositionSizingBasis(): KnowledgeBasis {
  const rule = KNOWLEDGE_RULES.find(r => r.id === POSITION_SIZING_RULE_ID);
  if (!rule) return { title: '리스크 기반 포지션 사이징', claims: [] };
  const claims = KNOWLEDGE_CLAIMS
    .filter(c => rule.claimIds.includes(c.id))
    .map(c => c.statement);
  return { title: rule.title, riskPolicy: rule.riskPolicy, claims };
}
