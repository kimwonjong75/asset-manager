// components/execution/TurtleSettingsPanel.tsx
// ---------------------------------------------------------------------------
// 터틀(위성) 최소 설정 패널 (Phase 2b-4c) — 실행 큐 상단.
//
// 목적: `satelliteBudgetKRW`(모든 사이징의 분모)를 입력받아야 진입 주문이 생성된다.
//   예산 0 = fail-closed(신규 매수 주문 미생성)이므로, 예산 입력 UI가 smoke test의 선결 조건.
//
// 범위(최소):
//   · 위성 예산(KRW) 입력 + "총자산의 10%로 설정" 헬퍼 + 저장(updateTurtleSettings).
//   · riskPerUnitPct/maxUnitsPerPosition/maxTotalRiskPct/positionValueCapPct는 기본값 유지(읽기 표시만).
//   · 저장은 명시적 버튼(키 입력마다 Drive 저장 방지). 10% 버튼은 입력만 채우고 저장은 사용자가 확인.
// UI 렌더만 담당(프로젝트 규칙) — 상태 저장은 context 액션(updateTurtleSettings).

import React, { useEffect, useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';

const fmtKRW = (n: number): string =>
  Number.isFinite(n) ? `₩${Math.round(n).toLocaleString('ko-KR')}` : '—';

const TurtleSettingsPanel: React.FC = () => {
  const { data, derived, actions } = usePortfolio();
  const settings = data.turtleSettings;
  const totalValue = derived.totalValue;
  const budget = settings.satelliteBudgetKRW;

  const [budgetInput, setBudgetInput] = useState<string>(budget > 0 ? String(budget) : '');
  const [saved, setSaved] = useState<boolean>(false);

  // 외부에서 예산이 바뀌면(로드/다른 경로 저장) 입력 동기화
  useEffect(() => {
    setBudgetInput(budget > 0 ? String(budget) : '');
    setSaved(false);
  }, [budget]);

  const parsed = Math.floor(Number(budgetInput));
  const isValid = budgetInput.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;
  const dirty = isValid && parsed !== budget;

  const tenPercent = Math.max(0, Math.round(totalValue * 0.1));

  const setTenPercent = () => {
    setBudgetInput(String(tenPercent));
    setSaved(false);
  };

  const save = () => {
    if (!isValid || !dirty) return;
    actions.updateTurtleSettings({ ...settings, satelliteBudgetKRW: parsed });
    setSaved(true);
  };

  return (
    <div className={`mb-3 rounded-lg border p-3.5 ${budget <= 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-gray-700 bg-gray-800/60'}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold text-gray-100">터틀(위성) 예산</h2>
        <span className="text-[11px] text-gray-500">총자산 {fmtKRW(totalValue)}</span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[160px]">
          <label htmlFor="turtle-budget" className="block text-[11px] text-gray-400 mb-1">위성 예산 (KRW)</label>
          <input
            id="turtle-budget"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={budgetInput}
            onChange={e => { setBudgetInput(e.target.value); setSaved(false); }}
            placeholder="예: 95,000,000"
            className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-primary"
          />
        </div>
        <button
          type="button"
          onClick={setTenPercent}
          disabled={totalValue <= 0}
          className="text-xs text-gray-200 bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={totalValue > 0 ? `총자산의 10% = ${fmtKRW(tenPercent)}` : '총자산이 계산되면 사용할 수 있습니다'}
        >총자산의 10%로 설정</button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty}
          className="text-xs font-medium text-white bg-primary hover:bg-primary-dark px-4 py-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >저장</button>
        {saved && !dirty && <span className="text-xs text-emerald-400 pb-1.5">✓ 저장됨</span>}
      </div>

      {budget <= 0 ? (
        <p className="text-[11px] text-amber-300 mt-2">
          예산이 0이면 신규 매수(진입) 주문이 생성되지 않습니다. 위성 계좌에 배정한 금액을 입력하세요.
        </p>
      ) : (
        <p className="text-[11px] text-gray-500 mt-2">
          1% 손실규칙의 기준 계좌입니다. 코어(90%)에는 손절이 없습니다.
        </p>
      )}

      {/* 고정 사이징 파라미터 (기본값 유지 — 읽기 표시만) */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5 pt-2.5 border-t border-gray-700/60 text-[11px] text-gray-500">
        <span>유닛 리스크 <span className="text-gray-300">{settings.riskPerUnitPct}%</span></span>
        <span>최대 <span className="text-gray-300">{settings.maxUnitsPerPosition}유닛</span></span>
        <span>동시 전멸 한도 <span className="text-gray-300">{settings.maxTotalRiskPct}%</span></span>
        <span>1종목 상한 <span className="text-gray-300">{settings.positionValueCapPct}%</span></span>
        <span>진입 <span className="text-gray-300">{settings.entryLookback}일</span> · 청산 <span className="text-gray-300">{settings.exitLookback}일</span></span>
      </div>
    </div>
  );
};

export default TurtleSettingsPanel;
