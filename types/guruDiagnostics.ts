// types/guruDiagnostics.ts
// 진단 패널(5A-⑤) 조합/뷰 타입 — 진단 결과(types/knowledge)와 평가 대상(utils/guruSignalEngine)을
// 엮는 뷰모델이라 양쪽을 참조한다. types/store.ts와 동일하게 "조합 타입 집결지가 utils/hooks를
// type-import" 하는 확립된 패턴을 따른다(guruSignalEngine은 이 파일을 import하지 않으므로 순환 없음).

import type { RuleDiagnostic, DiagnosticSummary, RuleStatusDescriptor } from './knowledge';
import type { GuruSignalTarget } from '../utils/guruSignalEngine';

/** 규칙 진단 1건 + 사용자용 정밀 상태(describeRuleStatus 산출). */
export interface DiagnosticRow {
  diagnostic: RuleDiagnostic;
  status: RuleStatusDescriptor;
}

/** useGuruDiagnostics 훅 반환 뷰모델 — 진단 패널이 렌더만 하도록 선택 상태·정렬된 행·요약을 노출. */
export interface GuruDiagnosticsView {
  /** 선택 가능한 전체 대상(포트폴리오 + 관심종목). */
  targets: GuruSignalTarget[];
  /** 실제 적용 중인 선택 id(미선택/사라진 종목이면 첫 종목으로 폴백). */
  selectedId: string | null;
  selectedTarget: GuruSignalTarget | null;
  selectTarget: (assetId: string) => void;
  /** 선택 종목 × 전 신호 규칙 진단 + 상태(발화 근접 순 정렬). advisory는 guruDiagnostics가 제외. */
  rows: DiagnosticRow[];
  /** 3축 요약(선택 종목 기준). 선택 없으면 null. */
  summary: DiagnosticSummary | null;
}
