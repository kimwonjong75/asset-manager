// components/settings/KakaoNotifySection.tsx
// 카카오톡 알림 설정 섹션 — 렌더 전용(RULES.md §2). 데이터/네트워크는 전부 hooks/useKakaoNotify.
// components/AiSettingsSection.tsx와 동일한 BYOK류 카드 스타일(다크 테마, localStorage 전용 고지).

import React, { useState } from 'react';
import { useKakaoNotify } from '../../hooks/useKakaoNotify';
import KakaoSetupWizard from './KakaoSetupWizard';
import Toggle from '../common/Toggle';
import Badge from '../common/Badge';
import { CircleAlert, Lock, TriangleAlert } from 'lucide-react';

function formatDateTime(iso: string | null): string {
  if (!iso) return '없음';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '없음';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

const KakaoNotifySection: React.FC = () => {
  const {
    settings, manifest, needsSync, opStatus, lastError, gasStatus,
    setGasUrl, setSecret, setAutoSync, setPyramidAlerts,
    syncNow, testConnection, refreshStatus,
  } = useKakaoNotify();

  const [showSecret, setShowSecret] = useState(false);
  const busy = opStatus !== 'idle';
  const turtleHoldingCount = (manifest.turtle?.legacyHoldings.length ?? 0) + (manifest.turtle?.reentryPositions.length ?? 0);
  const turtleWatchCount = manifest.turtle?.watchItems.length ?? 0;

  return (
    <div className="bg-gray-800 rounded-lg">
      <div className="px-6 py-5 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">카카오톡 알림</h2>
        <p className="text-gray-400 text-sm mt-1">
          매매 계획의 손절선·익절선·불타기선은 개장 중 매시간, 추세선 이탈은 마감 확정 종가로 1회 카카오톡("나에게 보내기")으로 알려드립니다.
        </p>
        <p className="text-gray-400 text-xs mt-1">
          터틀 알림 포함 — 보유 {turtleHoldingCount}종목 · 감시 {turtleWatchCount}종목의 팔 때·다시 살 때·추가 매수·손절 이탈을 마감 후 1회 + 아침 요약으로 알려드립니다.
        </p>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* 고지 */}
        <div className="bg-warning-soft border border-warning/30 rounded-lg p-3">
          <p className="text-xs text-gray-200 leading-relaxed">
            <TriangleAlert className="inline h-3.5 w-3.5 mr-1 align-[-2px] text-warning" aria-hidden="true" />카톡은 알려줄 뿐 대신 팔아주지 않습니다 — 손절은 증권사 예약주문이 먼저입니다.
          </p>
        </div>

        {/* 1회 설정 가이드 */}
        <KakaoSetupWizard />

        {/* 연결 설정 */}
        <div className="bg-gray-900 rounded-lg p-4 space-y-3">
          <div>
            <label className="text-white font-medium text-sm block mb-1">웹앱 URL</label>
            <input
              type="text"
              value={settings.gasUrl}
              onChange={(e) => setGasUrl(e.target.value.trim())}
              placeholder="https://script.google.com/macros/s/.../exec"
              autoComplete="off"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-white font-medium text-sm block mb-1">공유 시크릿</label>
            <div className="flex items-center gap-2">
              <input
                type={showSecret ? 'text' : 'password'}
                value={settings.secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="스크립트 속성 SHARED_SECRET과 동일한 값"
                autoComplete="off"
                className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowSecret(v => !v)}
                className="text-xs px-2 py-2 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
              >
                {showSecret ? '숨김' : '표시'}
              </button>
            </div>
            <p className="text-gray-500 text-xs mt-1">
              <Lock className="inline h-3.5 w-3.5 mr-1 align-[-2px]" aria-hidden="true" />웹앱 URL·시크릿은 <b>이 브라우저(localStorage)에만</b> 저장됩니다. Google Drive 동기화에 포함되지 않으므로 다른 기기에서는 다시 입력해야 합니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => { void testConnection(); }}
              disabled={busy || !settings.gasUrl || !settings.secret}
              className="text-sm px-3 py-2 rounded bg-gray-700 text-white hover:bg-gray-600 transition disabled:opacity-40"
            >
              {opStatus === 'testing' ? '테스트 중...' : '연결 테스트'}
            </button>
            <button
              type="button"
              onClick={() => { void syncNow(); }}
              disabled={busy || !settings.gasUrl || !settings.secret}
              className="text-sm px-3 py-2 rounded bg-primary text-white hover:opacity-90 transition disabled:opacity-40"
            >
              {opStatus === 'syncing' ? '동기화 중...' : '지금 동기화'}
            </button>
            <button
              type="button"
              onClick={() => { void refreshStatus(); }}
              disabled={busy || !settings.gasUrl || !settings.secret}
              className="text-sm px-3 py-2 rounded bg-gray-700 text-white hover:bg-gray-600 transition disabled:opacity-40"
            >
              {opStatus === 'checking' ? '조회 중...' : '상태 새로고침'}
            </button>
            {needsSync ? (
              <Badge tone="warning" size="md">동기화 필요 · 계획 {manifest.items.length}건</Badge>
            ) : (
              <Badge tone="ok" size="md">최신 상태</Badge>
            )}
          </div>

          {lastError && <p className="flex items-center gap-1 text-xs text-danger" role="alert"><CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{lastError}</p>}

          <div className="grid grid-cols-2 gap-3 pt-1 text-xs text-gray-400">
            <div>마지막 동기화: <span className="text-gray-300">{formatDateTime(settings.lastSyncAt)}</span></div>
            <div>마지막 테스트: <span className="text-gray-300">{formatDateTime(settings.lastTestAt)}</span></div>
          </div>

          {gasStatus && gasStatus.ok && (
            <div className="text-xs text-gray-400 border-t border-gray-800 pt-2 space-y-0.5">
              <div>카카오 연결: <span className={gasStatus.kakaoConnected ? 'text-ok' : 'text-danger'}>{gasStatus.kakaoConnected ? '연결됨' : '미연결'}</span></div>
              {typeof gasStatus.dailyCount === 'number' && <div>오늘 발송: <span className="text-gray-300">{gasStatus.dailyCount}건</span></div>}
              {gasStatus.lastRun && (
                <div>
                  마지막 실행: <span className="text-gray-300">{formatDateTime(gasStatus.lastRun.at)}</span>{' '}
                  <span className={gasStatus.lastRun.status === 'ok' ? 'text-ok' : 'text-danger'}>
                    {gasStatus.lastRun.status === 'ok' ? '정상' : `오류: ${gasStatus.lastRun.message ?? ''}`}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 옵션 */}
        <div className="bg-gray-900 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-white font-medium text-sm">자동 동기화</span>
              <p className="text-gray-500 text-xs mt-0.5">계획이 바뀌면 5초 뒤 자동으로 동기화합니다(꺼져 있으면 [지금 동기화]를 직접 눌러야 합니다).</p>
            </div>
            <Toggle checked={settings.autoSync} onChange={setAutoSync} />
          </div>
          <div className="flex items-center justify-between border-t border-gray-800 pt-3">
            <div>
              <span className="text-white font-medium text-sm">불타기 알림</span>
              <p className="text-gray-500 text-xs mt-0.5">기본 꺼짐 — 불타기는 검증되지 않은 기능입니다(RULES D4). 켜면 불타기선 도달 시에도 카톡이 옵니다.</p>
            </div>
            <Toggle checked={settings.pyramidAlerts} onChange={setPyramidAlerts} />
          </div>
        </div>

        {/* 운영 규약 */}
        <div className="bg-gray-900 rounded-lg p-4 space-y-1 text-xs text-gray-400">
          <p>· 손절선·익절선·불타기선: 개장 중 매시간(±15분) 확인 · 추세선 이탈: 마감 확정 종가로 1회</p>
          <p>· 정숙시간 00:00~07:00 KST에는 발송을 보류했다가 07:00에 모아서 보냅니다</p>
          <p>· 하루 발송 상한 8건 — 초과분은 요약 1건으로 묶입니다</p>
          <p>· 같은 종목·같은 신호·같은 날은 한 번만 보냅니다(멱등)</p>
        </div>
      </div>
    </div>
  );
};

export default KakaoNotifySection;
