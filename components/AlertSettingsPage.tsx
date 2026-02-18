import React, { useCallback } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import type { AlertRule, AlertSettings } from '../types/alertRules';
import { DEFAULT_ALERT_SETTINGS } from '../constants/alertRules';

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

  const updateRuleConfig = useCallback((ruleId: string, configKey: string, value: number) => {
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
                  {[20, 60, 120, 200].map(p => (
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
