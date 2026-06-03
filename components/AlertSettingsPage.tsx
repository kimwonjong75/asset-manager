import React, { useCallback } from 'react';
import { Info } from 'lucide-react';
import { usePortfolio } from '../contexts/PortfolioContext';
import type { AlertRule, AlertSettings } from '../types/alertRules';
import { DEFAULT_ALERT_SETTINGS } from '../constants/alertRules';
import Tooltip from './common/Tooltip';

const RULE_SUMMARY_TOOLTIPS: Record<string, string> = {
  'climax-top': "가파르고 뜨겁게 오른 '과열' 상태를 잡는 규칙.",
  'distribution-high': "거래량은 터졌는데 가격이 못 오르는 '매물 떠넘기기'를 잡는 규칙.",
};

const FieldLabel: React.FC<{ text: string; tip: string }> = ({ text, tip }) => (
  <Tooltip content={tip} wrap>
    <span className="inline-flex items-center gap-0.5 cursor-help">
      {text}
      <Info className="w-3 h-3 text-gray-400" />
    </span>
  </Tooltip>
);

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: '긴급',
  warning: '주의',
  info: '참고',
};

const AlertSettingsPage: React.FC = () => {
  const { ui, actions } = usePortfolio();
  const { alertSettings } = ui;

  const updateRule = useCallback((ruleId: string, updates: Partial<AlertRule>) => {
    const newRules = alertSettings.rules.map(r =>
      r.id === ruleId ? { ...r, ...updates } : r
    );
    actions.updateAlertSettings({ ...alertSettings, rules: newRules });
  }, [alertSettings, actions]);

  const updateRuleConfig = useCallback((ruleId: string, configKey: string, value: number | boolean) => {
    const newRules = alertSettings.rules.map(r =>
      r.id === ruleId
        ? { ...r, filterConfig: { ...r.filterConfig, [configKey]: value } }
        : r
    );
    actions.updateAlertSettings({ ...alertSettings, rules: newRules });
  }, [alertSettings, actions]);

  const handleResetDefaults = () => {
    if (window.confirm('모든 알림 설정을 기본값으로 초기화하시겠습니까?')) {
      actions.updateAlertSettings(DEFAULT_ALERT_SETTINGS);
    }
  };

  const sellRules = alertSettings.rules.filter(r => r.action === 'sell');
  const buyRules = alertSettings.rules.filter(r => r.action === 'buy');

  const renderRuleCard = (rule: AlertRule) => {
    const config = rule.filterConfig;
    return (
      <div
        key={rule.id}
        className={`bg-gray-800 border rounded-lg p-4 transition ${
          rule.enabled ? 'border-gray-600' : 'border-gray-700 opacity-50'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* 활성/비활성 토글 */}
            <button
              onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}
              className={`flex-shrink-0 w-10 h-5 rounded-full transition-colors relative ${
                rule.enabled ? 'bg-primary' : 'bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  rule.enabled ? 'left-5' : 'left-0.5'
                }`}
              />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${SEVERITY_COLORS[rule.severity]}`} />
                <span className="text-white font-medium text-sm">{rule.name}</span>
                {RULE_SUMMARY_TOOLTIPS[rule.id] && (
                  <Tooltip content={RULE_SUMMARY_TOOLTIPS[rule.id]} wrap>
                    <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
                  </Tooltip>
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${SEVERITY_COLORS[rule.severity]} text-white`}>
                  {SEVERITY_LABELS[rule.severity]}
                </span>
              </div>
              <p className="text-gray-400 text-xs mt-1">{rule.description}</p>
            </div>
          </div>

          {/* 설정 영역 */}
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            {config.lossThreshold !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <span>손실률</span>
                <input
                  type="number"
                  value={config.lossThreshold}
                  onChange={(e) => updateRuleConfig(rule.id, 'lossThreshold', Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center"
                  min="0"
                />
                <span>%</span>
              </div>
            )}
            {config.maShortPeriod !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <span>{config.maLongPeriod !== undefined ? '단기' : '이평선'}</span>
                <select
                  value={config.maShortPeriod}
                  onChange={(e) => updateRuleConfig(rule.id, 'maShortPeriod', parseInt(e.target.value))}
                  className="bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs"
                >
                  {(config.maLongPeriod !== undefined ? [5, 10, 20, 60] : [5, 10, 20, 60, 120, 200]).map(p => (
                    <option key={p} value={p} disabled={config.maLongPeriod !== undefined && p >= config.maLongPeriod}>MA{p}</option>
                  ))}
                </select>
              </div>
            )}
            {config.maLongPeriod !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <span>장기</span>
                <select
                  value={config.maLongPeriod}
                  onChange={(e) => updateRuleConfig(rule.id, 'maLongPeriod', parseInt(e.target.value))}
                  className="bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs"
                >
                  {[20, 60, 120, 150, 200].map(p => (
                    <option key={p} value={p} disabled={config.maShortPeriod !== undefined && p <= config.maShortPeriod}>MA{p}</option>
                  ))}
                </select>
              </div>
            )}
            {config.dropFromHighThreshold !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <span>하락률</span>
                <input
                  type="number"
                  value={config.dropFromHighThreshold}
                  onChange={(e) => updateRuleConfig(rule.id, 'dropFromHighThreshold', Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center"
                  min="0"
                />
                <span>%</span>
              </div>
            )}
            {config.profitTargetThreshold !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <span>목표 수익률</span>
                <input
                  type="number"
                  value={config.profitTargetThreshold}
                  onChange={(e) => updateRuleConfig(rule.id, 'profitTargetThreshold', Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center"
                  min="0"
                />
                <span>%</span>
              </div>
            )}
            {config.dailySurgeThreshold !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <span>급등률</span>
                <input
                  type="number"
                  value={config.dailySurgeThreshold}
                  onChange={(e) => updateRuleConfig(rule.id, 'dailySurgeThreshold', Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center"
                  min="0"
                />
                <span>%</span>
              </div>
            )}
            {config.maCrossPeriod !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <span>이평선</span>
                <select
                  value={config.maCrossPeriod}
                  onChange={(e) => updateRuleConfig(rule.id, 'maCrossPeriod', parseInt(e.target.value))}
                  className="bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs"
                >
                  {[20, 60, 120, 150, 200].map(p => (
                    <option key={p} value={p}>MA{p}</option>
                  ))}
                </select>
              </div>
            )}
            {config.dailyCrashThreshold !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <span>급락률</span>
                <input
                  type="number"
                  value={config.dailyCrashThreshold}
                  onChange={(e) => updateRuleConfig(rule.id, 'dailyCrashThreshold', Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center"
                  min="0"
                />
                <span>%</span>
              </div>
            )}
            {config.withinDays !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <span>감지유지</span>
                <input
                  type="number"
                  value={config.withinDays}
                  onChange={(e) => updateRuleConfig(rule.id, 'withinDays', Math.max(0, Math.min(30, parseInt(e.target.value) || 0)))}
                  className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center"
                  min="0"
                  max="30"
                />
                <span>일</span>
              </div>
            )}
            {config.maxLookbackTradingDays !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <span>최대 감지기간</span>
                <select
                  value={config.maxLookbackTradingDays}
                  onChange={(e) => updateRuleConfig(rule.id, 'maxLookbackTradingDays', parseInt(e.target.value))}
                  className="bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs"
                >
                  <option value={22}>1개월</option>
                  <option value={66}>3개월</option>
                  <option value={132}>6개월</option>
                  <option value={252}>1년</option>
                </select>
              </div>
            )}
            {/* ── 클라이맥스 탑 임계값 ── */}
            {config.climaxFlagsRequired !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <FieldLabel
                  text="충족 플래그"
                  tip="3가지 과열 조건 중 몇 개 이상이면 경고할지. 낮출수록 경고가 자주 뜸."
                />
                <input
                  type="number"
                  value={config.climaxFlagsRequired}
                  onChange={(e) => updateRuleConfig(rule.id, 'climaxFlagsRequired', Math.max(1, Math.min(3, parseInt(e.target.value) || 1)))}
                  className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center"
                  min="1"
                  max="3"
                />
                <span>/3</span>
              </div>
            )}
            {config.climaxSlopeMultiplier !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <FieldLabel
                  text="기울기 배수"
                  tip="최근 10일 상승 각도가 평소(60일)의 몇 배일 때 급가속으로 볼지. 클수록 둔감."
                />
                <input
                  type="number"
                  step="0.5"
                  value={config.climaxSlopeMultiplier}
                  onChange={(e) => updateRuleConfig(rule.id, 'climaxSlopeMultiplier', Math.max(1, Math.min(10, parseFloat(e.target.value) || 1)))}
                  className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center"
                  min="1"
                  max="10"
                />
                <span>배</span>
              </div>
            )}
            {config.climaxAtrMultiple !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <FieldLabel
                  text="ATR 배수"
                  tip="하루 변동폭이 평소(ATR14)의 몇 배일 때 변동성 폭발로 볼지. 클수록 둔감."
                />
                <input
                  type="number"
                  step="0.5"
                  value={config.climaxAtrMultiple}
                  onChange={(e) => updateRuleConfig(rule.id, 'climaxAtrMultiple', Math.max(1, Math.min(5, parseFloat(e.target.value) || 1)))}
                  className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center"
                  min="1"
                  max="5"
                />
                <span>배</span>
              </div>
            )}
            {config.climaxRequireBullishCandle !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <FieldLabel
                  text="양봉만"
                  tip="변동성 폭발일을 상승(양봉)일 때만 카운트. 끄면 ±급변동일도 포함 — 거짓 신호 증가."
                />
                <button
                  onClick={() => updateRuleConfig(rule.id, 'climaxRequireBullishCandle', !config.climaxRequireBullishCandle)}
                  className={`flex-shrink-0 w-8 h-4 rounded-full transition-colors relative ${
                    config.climaxRequireBullishCandle ? 'bg-primary' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                      config.climaxRequireBullishCandle ? 'left-4' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
            )}
            {config.climaxRequireLongTrendUp !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <FieldLabel
                  text="수개월상승 전제"
                  tip="최근 60일간 평균선이 10%+ 우상향일 때만 경고. 끄면 박스권/낙폭 종목도 클라이맥스로 잡힘."
                />
                <button
                  onClick={() => updateRuleConfig(rule.id, 'climaxRequireLongTrendUp', !config.climaxRequireLongTrendUp)}
                  className={`flex-shrink-0 w-8 h-4 rounded-full transition-colors relative ${
                    config.climaxRequireLongTrendUp ? 'bg-primary' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                      config.climaxRequireLongTrendUp ? 'left-4' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
            )}
            {/* ── 디스트리뷰션 임계값 ── */}
            {config.distributionWindow !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <FieldLabel
                  text="카운트 기간"
                  tip="최근 며칠(거래일)을 검사할지."
                />
                <input
                  type="number"
                  value={config.distributionWindow}
                  onChange={(e) => updateRuleConfig(rule.id, 'distributionWindow', Math.max(5, Math.min(30, parseInt(e.target.value) || 5)))}
                  className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center"
                  min="5"
                  max="30"
                />
                <span>일</span>
              </div>
            )}
            {config.distributionVolumeRatio !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <FieldLabel
                  text="거래량 배수"
                  tip="거래량이 50일 평균의 몇 배 넘은 날만 의심일로 셀지. 클수록 거래량 폭증한 날만 포함."
                />
                <input
                  type="number"
                  step="0.1"
                  value={config.distributionVolumeRatio}
                  onChange={(e) => updateRuleConfig(rule.id, 'distributionVolumeRatio', Math.max(1, Math.min(3, parseFloat(e.target.value) || 1)))}
                  className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center"
                  min="1"
                  max="3"
                />
                <span>배</span>
              </div>
            )}
            {config.distributionThreshold !== undefined && (
              <div className="flex items-center gap-1 text-xs text-gray-300">
                <FieldLabel
                  text="누적 임계"
                  tip="의심일이 며칠 이상 쌓이면 경고할지. 낮출수록 예민."
                />
                <input
                  type="number"
                  value={config.distributionThreshold}
                  onChange={(e) => updateRuleConfig(rule.id, 'distributionThreshold', Math.max(1, Math.min(15, parseInt(e.target.value) || 1)))}
                  className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center"
                  min="1"
                  max="15"
                />
                <span>일</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-gray-800 rounded-lg shadow-lg">
        {/* 헤더 */}
        <div className="px-6 py-5 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">투자 시그널 알림 설정</h2>
          <p className="text-gray-400 text-sm mt-1">앱 접속 시 자동 브리핑 팝업과 프리셋 필터에 사용되는 규칙을 관리합니다.</p>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* 자동 팝업 토글 */}
          <div className="flex items-center justify-between bg-gray-900 rounded-lg p-4">
            <div>
              <span className="text-white font-medium text-sm">앱 접속 시 자동 브리핑 팝업</span>
              <p className="text-gray-400 text-xs mt-0.5">시세 업데이트 완료 후 시그널이 감지되면 팝업을 표시합니다 (하루 1회)</p>
            </div>
            <button
              onClick={() => actions.updateAlertSettings({
                ...alertSettings,
                enableAutoPopup: !alertSettings.enableAutoPopup
              })}
              className={`flex-shrink-0 w-12 h-6 rounded-full transition-colors relative ${
                alertSettings.enableAutoPopup ? 'bg-primary' : 'bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  alertSettings.enableAutoPopup ? 'left-6' : 'left-0.5'
                }`}
              />
            </button>
          </div>

          {/* 매도 감지 규칙 */}
          <div>
            <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              매도 감지 규칙
            </h3>
            <div className="space-y-3">
              {sellRules.map(renderRuleCard)}
            </div>
          </div>

          {/* 매수 기회 규칙 */}
          <div>
            <h3 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              매수 기회 규칙
            </h3>
            <div className="space-y-3">
              {buyRules.map(renderRuleCard)}
            </div>
          </div>

          {/* 초기화 버튼 */}
          <div className="flex justify-end pt-2 pb-2">
            <button
              onClick={handleResetDefaults}
              className="text-sm text-gray-400 hover:text-white transition px-3 py-1.5 bg-gray-700 rounded-md hover:bg-gray-600"
            >
              기본값으로 초기화
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlertSettingsPage;
