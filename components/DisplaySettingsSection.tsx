import React, { useState, useEffect } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useFontScale } from '../hooks/useFontScale';
import type { PLBasis } from '../types/valuation';
import { PL_BASIS_ORDER, PL_BASIS_LABELS, PL_BASIS_SUBLABELS } from '../types/valuation';

const PRESET_VALUES = [
  { label: '50만', value: 500_000 },
  { label: '100만', value: 1_000_000 },
  { label: '300만', value: 3_000_000 },
  { label: '500만', value: 5_000_000 },
  { label: '1,000만', value: 10_000_000 },
];

const DisplaySettingsSection: React.FC = () => {
  const { data, ui, actions } = usePortfolio();
  const { isLarge, setLarge } = useFontScale();
  const [draft, setDraft] = useState<string>(String(ui.lowValueThreshold));

  useEffect(() => {
    setDraft(String(ui.lowValueThreshold));
  }, [ui.lowValueThreshold]);

  const commit = (value: number) => {
    actions.setLowValueThreshold(value);
  };

  const handleBlur = () => {
    const n = Number(draft.replace(/[^0-9]/g, ''));
    const v = Number.isFinite(n) && n >= 0 ? n : 0;
    commit(v);
  };

  // --- 차트 이동평균선(MA) 6슬롯 설정 ---
  const [maDrafts, setMaDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(ui.chartMAConfigs.map(c => [c.id, String(c.period)]))
  );
  useEffect(() => {
    setMaDrafts(Object.fromEntries(ui.chartMAConfigs.map(c => [c.id, String(c.period)])));
  }, [ui.chartMAConfigs]);

  const commitMAPeriod = (id: string, raw: string) => {
    const n = Number(raw.replace(/[^0-9]/g, ''));
    const period = Number.isFinite(n) && n > 0 ? n : 1; // Context에서 1~400으로 클램프
    actions.setChartMAConfigs(ui.chartMAConfigs.map(c => (c.id === id ? { ...c, period } : c)));
  };
  const toggleMAEnabled = (id: string) => {
    actions.setChartMAConfigs(ui.chartMAConfigs.map(c => (c.id === id ? { ...c, enabled: !c.enabled } : c)));
  };

  return (
    <div className="bg-gray-800 rounded-lg">
      <div className="px-6 py-5 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">표시 설정</h2>
        <p className="text-gray-400 text-sm mt-1">포트폴리오 리스트의 표시 옵션을 관리합니다.</p>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* 수익률 기준 — 표·대시보드·알림 판정이 모두 이 설정을 따른다(저장 데이터는 그대로) */}
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="min-w-0 mb-2">
            <span className="text-white font-medium text-sm">수익률 기준</span>
            <p className="text-gray-400 text-xs mt-0.5">
              해외 종목의 수익률과 평가손익을 어떤 기준으로 계산할지 고릅니다.
            </p>
          </div>

          <div className="inline-flex rounded-md border border-gray-600 overflow-hidden" role="group" aria-label="수익률 기준">
            {PL_BASIS_ORDER.map((basis: PLBasis) => {
              const on = data.valuationSettings.plBasis === basis;
              return (
                <button
                  key={basis}
                  type="button"
                  onClick={() => actions.updateValuationSettings({ plBasis: basis })}
                  aria-pressed={on}
                  className={`px-3 py-1.5 text-xs text-center transition-colors ${
                    on ? 'bg-primary text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  } ${basis !== PL_BASIS_ORDER[0] ? 'border-l border-gray-600' : ''}`}
                >
                  <div className="font-medium">{PL_BASIS_LABELS[basis]}</div>
                  <div className="text-xs opacity-70">{PL_BASIS_SUBLABELS[basis]}</div>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-xs text-gray-400 leading-relaxed">
            달러 기준은 환율 변동을 빼고 종목 자체의 손익만 보여줍니다. 키움 등 증권사 화면에 뜨는 숫자와 같습니다.
            <br />
            원화 기준은 환율로 생긴 손익까지 더해서 실제 원화 자산이 얼마나 늘고 줄었는지 보여줍니다.
            <br />
            손절·익절 알림도 여기서 고른 기준을 따릅니다.
          </p>
        </div>

        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <span className="text-white font-medium text-sm">소액 자산 숨김 임계값</span>
              <p className="text-gray-400 text-xs mt-0.5">
                포트폴리오 상단 토글을 켰을 때 평가총액(KRW)이 이 값 미만인 자산을 숨깁니다.
              </p>
            </div>
            <div className="flex items-center gap-1 text-sm text-gray-300">
              <input
                type="text"
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={handleBlur}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="w-32 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm text-right"
              />
              <span className="text-gray-400">원</span>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-xs text-gray-500">빠른 설정:</span>
            {PRESET_VALUES.map(p => (
              <button
                key={p.value}
                onClick={() => commit(p.value)}
                className={`text-xs px-2 py-1 rounded transition ${
                  ui.lowValueThreshold === p.value
                    ? 'bg-primary text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-2 text-xs text-gray-500">
            현재값: {ui.lowValueThreshold.toLocaleString('ko-KR')}원
          </div>
        </div>

        {/* 차트 이동평균선 설정 */}
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <span className="text-white font-medium text-sm">차트 이동평균선 (MA)</span>
              <p className="text-gray-400 text-xs mt-0.5">
                개별 차트에 표시되는 이동평균선 6개의 기간(일)과 표시 여부를 설정합니다.
                <br />
                ※ 알림·스마트필터에서 사용하는 이평선과는 별개입니다.
              </p>
            </div>
            <button
              onClick={() => actions.resetChartMAConfigs()}
              className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
            >
              기본값 복원
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            {ui.chartMAConfigs.map(c => (
              <div key={c.id} className="flex items-center gap-2 bg-gray-800 rounded px-3 py-2">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                <span className="text-xs text-gray-400">MA</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={maDrafts[c.id] ?? ''}
                  onChange={(e) => setMaDrafts(prev => ({ ...prev, [c.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                  onBlur={(e) => commitMAPeriod(c.id, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="w-14 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm text-right"
                />
                <span className="text-xs text-gray-500">일</span>
                <button
                  onClick={() => toggleMAEnabled(c.id)}
                  className={`ml-auto text-xs px-2 py-1 rounded-full border transition-colors ${
                    c.enabled
                      ? 'text-white border-transparent'
                      : 'text-gray-400 border-gray-600 bg-transparent hover:border-gray-500'
                  }`}
                  style={c.enabled ? { backgroundColor: c.color, borderColor: c.color } : undefined}
                >
                  {c.enabled ? '표시' : '숨김'}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-gray-500">기간은 1~400일 범위로 자동 보정됩니다.</div>
        </div>

        {/* 신호 표시 (Phase 5 — 신호 다이어트) */}
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="min-w-0 mb-1">
            <span className="text-white font-medium text-sm">신호 표시</span>
            <p className="text-gray-400 text-xs mt-0.5">
              참고형 신호(구루 신호)의 표시 위치와 크기를 조정합니다.
              <br />
              ※ 실제 실행할 주문은 홈 <span className="text-gray-300">오늘의 브리핑</span>의 대기 주문이 기준이며, 아래 설정은 표시 방식만 바꿉니다(신호 계산·발화 무관).
            </p>
          </div>

          <SignalToggleRow
            title="구루 신호를 홈 상단에 크게 표시"
            desc="끄면 홈 하단 '참고 지표' 접힘 섹션으로 이동합니다 (기본값)."
            checked={ui.signalDisplay.showGuruSignalsProminently}
            onChange={(v) => actions.setSignalDisplay({ showGuruSignalsProminently: v })}
          />
          <div className="mt-3 pt-3 border-t border-gray-800">
            <SignalToggleRow
              title="기존 신호 보기"
              desc="터틀 중심 재정비 이후 숨긴 구루 신호 카드 · 참고 지표(리스크 매트릭스/과열) · 알림 브리핑 자동 팝업을 한 번에 복원합니다 (기본 꺼짐). 계산·발화는 바뀌지 않고 표시만 켜고 끕니다. 브리핑 벨(수동 열기)은 이 설정과 무관하게 항상 동작합니다."
              checked={ui.signalDisplay.showLegacySignals}
              onChange={(v) => actions.setSignalDisplay({ showLegacySignals: v })}
            />
          </div>
        </div>

        {/* 글자 크게 (P6) — 루트 폰트 크기(rem 기준)를 바꾸므로 카드·표·여백까지 함께 커진다 */}
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="min-w-0 mb-1">
            <span className="text-white font-medium text-sm">화면 크기</span>
            <p className="text-gray-400 text-xs mt-0.5">글자와 버튼 크기를 조정합니다. 이 기기에만 적용됩니다.</p>
          </div>
          <SignalToggleRow
            title="글자 크게"
            desc={`기본 15px → 크게 17px. 표·카드의 여백도 함께 커집니다.`}
            checked={isLarge}
            onChange={setLarge}
          />
        </div>
      </div>
    </div>
  );
};

// 신호 표시 토글 행 (렌더 전용)
const SignalToggleRow: React.FC<{
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ title, desc, checked, onChange }) => (
  <div className="flex items-start justify-between gap-4 mt-3 first:mt-2">
    <div className="min-w-0">
      <span className="text-gray-200 text-sm">{title}</span>
      <p className="text-gray-500 text-xs mt-0.5">{desc}</p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-gray-600'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  </div>
);

export default DisplaySettingsSection;
