import React, { useState, useEffect } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';

const PRESET_VALUES = [
  { label: '50만', value: 500_000 },
  { label: '100만', value: 1_000_000 },
  { label: '300만', value: 3_000_000 },
  { label: '500만', value: 5_000_000 },
  { label: '1,000만', value: 10_000_000 },
];

const DisplaySettingsSection: React.FC = () => {
  const { ui, actions } = usePortfolio();
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
    <div className="bg-gray-800 rounded-lg shadow-lg">
      <div className="px-6 py-5 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">표시 설정</h2>
        <p className="text-gray-400 text-sm mt-1">포트폴리오 리스트의 표시 옵션을 관리합니다.</p>
      </div>

      <div className="px-6 py-4 space-y-4">
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
              참고형 신호(구루 신호·리스크 매트릭스)의 표시 위치와 크기를 조정합니다.
              <br />
              ※ 실제 실행할 주문은 <span className="text-gray-300">실행 큐</span>가 기준이며, 아래 설정은 표시 방식만 바꿉니다(신호 계산·발화 무관).
            </p>
          </div>

          <SignalToggleRow
            title="구루 신호를 대시보드 상단에 크게 표시"
            desc="끄면 대시보드 하단 '참고 지표' 접힘 섹션으로 이동합니다 (기본값)."
            checked={ui.signalDisplay.showGuruSignalsProminently}
            onChange={(v) => actions.setSignalDisplay({ showGuruSignalsProminently: v })}
          />
          <SignalToggleRow
            title="리스크 매트릭스를 알림 브리핑에서 항상 펼쳐 표시"
            desc="끄면 알림 브리핑 팝업에서 접힌 상태로 표시되며, 클릭하면 펼쳐집니다 (기본값)."
            checked={ui.signalDisplay.showRiskMatrixExpanded}
            onChange={(v) => actions.setSignalDisplay({ showRiskMatrixExpanded: v })}
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
