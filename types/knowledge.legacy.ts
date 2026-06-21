// 구루 지식 베이스 — 레거시(v1) 타입 보존용 아카이브
// ---------------------------------------------------------------------------
// 이 파일은 v1 "납작한 KnowledgeEntry" 스키마를 보존하기 위한 것이다.
// 신규 코드는 절대 import 하지 말 것 — constants/knowledgeBase.legacy.ts(데이터 아카이브) 전용.
// 정식 스키마는 types/knowledge.ts(v2: sources/claims/rules/journal 4컬렉션)를 사용한다.
// 전체 마이그레이션 완료 후 이 파일과 knowledgeBase.legacy.ts는 삭제 예정.

export type KnowledgeCategory =
  | 'market-regime'
  | 'screening'
  | 'entry-setup'
  | 'entry-timing'
  | 'exit-stoploss'
  | 'exit-profit'
  | 'position-sizing'
  | 'psychology';

export type GuruId =
  | 'kang-hwanguk'
  | 'kullamagi'
  | 'oneil'
  | 'minervini'
  | 'weinstein'
  | 'darvas'
  | 'livermore'
  | 'frohlich'
  | 'russo'
  | 'breitstein'
  | 'generic';

export type GuruTier = 'primary' | 'reference';

export type KnowledgeConfidence = 'strong' | 'qualified' | 'optional' | 'author-opinion';

export type KnowledgeVerification = 'draft' | 'verified' | 'rejected' | 'unverifiable-claim';

export type Computability = 'signal' | 'advisory';

export interface KnowledgeEntry {
  id: string;
  title: string;
  category: KnowledgeCategory;
  statement: string;
  parameters?: string;
  guru: GuruId;
  guruTier: GuruTier;
  computability: Computability;
  mappedSignalKey?: string;
  confidence: KnowledgeConfidence;
  verification: KnowledgeVerification;
  sourceDoc: string;
  sourceDate: string;
  addedDate: string;
  supersedes?: string[];
  citations?: string[];
  tags?: string[];
  note?: string;
}

export interface KnowledgeSource {
  id: string;
  title: string;
  date: string;
  type: 'lecture-transcript' | 'book' | 'article' | 'manual';
  origin: string;
  note?: string;
}

export interface KnowledgeBase {
  version: number;
  entries: KnowledgeEntry[];
  sources: KnowledgeSource[];
  lastUpdated: string;
}
