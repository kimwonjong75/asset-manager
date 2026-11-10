// hooks/useKakaoNotify.ts
// ---------------------------------------------------------------------------
// 카카오톡/텔레그램 알림(GAS) 설정 + 동기화 오케스트레이션(P5, 계획서 §6.1). 훅 이름은 유지하되
// 발송 채널(카카오톡/텔레그램/둘 다)을 설정으로 고른다 — 채널은 매니페스트에 실려 GAS(NOTIFY_CHANNEL)로 간다.
// 설정 컴포넌트(components/settings/KakaoNotifySection.tsx)는 services/를 직접 부르지 않는다
// (ESLint no-restricted-imports: components→services 금지, CLAUDE.md) — 연결 테스트·동기화·
// 상태 조회는 전부 이 훅을 거친다.
//
// 저장: localStorage 전용, Google Drive 동기화 payload에서 의도적으로 제외한다
// (services/geminiSettings.ts와 동일한 BYOK류 격리 규약 — GAS 웹앱 URL/공유 시크릿은
// 기기마다 따로 입력해야 한다는 뜻이며, 설정 마법사에 명시한다).
//
// autoSync는 opt-in(기본 OFF)일 때만 동작한다 — 사용자가 명시적으로 켠 로컬 설정에 따라
// 외부(GAS)로 매니페스트를 보내는 것이므로 "보이지 않는 쓰기 금지" 규칙(Drive 자동저장 금지)과는
// 다른 층이지만, 그래도 기본값은 OFF로 시작한다.

import { useState, useCallback, useMemo, useEffect } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import { setItemSafe } from '../utils/safeStorage';
import { createLogger } from '../utils/logger';
import { APP_PUBLIC_URL } from '../constants/api';
import { buildNotifyManifest, manifestHash, type NotifyManifest } from '../utils/notifyManifest';
import { normalizeNotifyChannel } from '../utils/notifyChannel';
import type { NotifyChannel } from '../types/notifyChannel';
import {
  syncManifest,
  testConnection as testGasConnection,
  fetchStatus as fetchGasStatus,
  connectTelegram as connectGasTelegram,
  type GasStatusResponse,
} from '../services/notifySyncService';

const log = createLogger('useKakaoNotify');

const SETTINGS_KEY = 'asset-manager-kakao-notify-v1';
/** GAS가 텔레그램 도입 이전 코드일 때(응답에 channel/results가 없거나 알 수 없는 action) 보여 줄 안내. */
const OLD_GAS_MESSAGE =
  'GAS 코드가 구버전이라 텔레그램을 모릅니다. npm run gas:push 후 Apps Script [배포 → 배포 관리 → 수정 → 새 버전]으로 갱신하세요.';

/** opt-in 자동 동기화 디바운스(계획서 §6.1: 명시적 opt-in이라도 즉시 발신하지 않는다). */
const AUTO_SYNC_DEBOUNCE_MS = 5000;

export interface KakaoNotifySettings {
  gasUrl: string;
  secret: string;
  autoSync: boolean;
  /** 불타기선 알림 발송 여부(기본 OFF — 불타기 자체가 미검증 기능, RULES D4). */
  pyramidAlerts: boolean;
  /** 발송 채널 — 기본 'kakao'(기존 동작). 매니페스트로 GAS에 전달된다. */
  channel: NotifyChannel;
  lastSyncAt: string | null;
  lastSyncHash: string | null;
  lastTestAt: string | null;
}

const DEFAULT_SETTINGS: KakaoNotifySettings = {
  gasUrl: '',
  secret: '',
  autoSync: false,
  pyramidAlerts: false,
  channel: 'kakao',
  lastSyncAt: null,
  lastSyncHash: null,
  lastTestAt: null,
};

function loadSettings(): KakaoNotifySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<KakaoNotifySettings>;
    return { ...DEFAULT_SETTINGS, ...parsed, channel: normalizeNotifyChannel(parsed.channel) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings(settings: KakaoNotifySettings): void {
  const result = setItemSafe(SETTINGS_KEY, JSON.stringify(settings));
  if (!result.ok) log.error('카카오 알림 설정 저장 실패', result);
}

export type KakaoNotifyOpStatus = 'idle' | 'syncing' | 'testing' | 'checking' | 'connecting';

/** 마지막 [텔레그램 연결] 결과(세션 내 상태 — 저장하지 않는다). */
export interface TelegramConnectState {
  ok: boolean;
  chatName?: string;
}

export interface UseKakaoNotifyResult {
  settings: KakaoNotifySettings;
  /** 현재 활성 계획으로 조립한 매니페스트(항상 최신 — 렌더마다 재조립되는 파생값). */
  manifest: NotifyManifest;
  /** 마지막으로 동기화 성공한 해시와 다르면 true. */
  needsSync: boolean;
  opStatus: KakaoNotifyOpStatus;
  lastError: string | null;
  gasStatus: GasStatusResponse | null;
  /** 마지막 [텔레그램 연결] 결과 — 성공 시 연결된 대화 이름. */
  telegramConnect: TelegramConnectState | null;
  setGasUrl: (url: string) => void;
  setSecret: (secret: string) => void;
  setAutoSync: (on: boolean) => void;
  setPyramidAlerts: (on: boolean) => void;
  /** 발송 채널 변경 — 저장 후 URL·시크릿이 있으면 새 채널이 실린 매니페스트를 즉시 동기화한다(명시적 사용자 동작). */
  setChannel: (channel: NotifyChannel) => Promise<void>;
  connectTelegram: () => Promise<void>;
  syncNow: () => Promise<void>;
  testConnection: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

export function useKakaoNotify(): UseKakaoNotifyResult {
  const { data } = usePortfolio();
  const [settings, setSettings] = useState<KakaoNotifySettings>(() => loadSettings());
  const [opStatus, setOpStatus] = useState<KakaoNotifyOpStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [gasStatus, setGasStatus] = useState<GasStatusResponse | null>(null);
  const [telegramConnect, setTelegramConnect] = useState<TelegramConnectState | null>(null);

  const update = useCallback((patch: Partial<KakaoNotifySettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      persistSettings(next);
      return next;
    });
  }, []);

  const manifest = useMemo(
    () => buildNotifyManifest({
      assets: data.assets,
      appUrl: APP_PUBLIC_URL,
      now: new Date().toISOString(),
      pyramidAlerts: settings.pyramidAlerts,
      channel: settings.channel,
      watchlist: data.watchlist,
      turtlePositions: data.turtlePositions,
      turtleHoldingsSettings: data.turtleSettings.holdings,
    }),
    [data.assets, data.watchlist, data.turtlePositions, data.turtleSettings.holdings, settings.pyramidAlerts, settings.channel],
  );

  const currentHash = useMemo(() => manifestHash(manifest), [manifest]);
  const needsSync = currentHash !== settings.lastSyncHash;

  const syncNow = useCallback(async () => {
    if (!settings.gasUrl || !settings.secret) {
      setLastError('웹앱 URL과 공유 시크릿을 먼저 입력하세요.');
      return;
    }
    setOpStatus('syncing');
    setLastError(null);
    try {
      const res = await syncManifest(settings.gasUrl, settings.secret, manifest);
      if (res.ok) {
        update({ lastSyncAt: res.receivedAt ?? new Date().toISOString(), lastSyncHash: currentHash });
        if (manifest.channel !== 'kakao' && res.channel === undefined) setLastError(OLD_GAS_MESSAGE);
      } else {
        setLastError(res.error ?? '동기화에 실패했습니다.');
      }
    } finally {
      setOpStatus('idle');
    }
  }, [settings.gasUrl, settings.secret, manifest, currentHash, update]);

  const testConnection = useCallback(async () => {
    if (!settings.gasUrl || !settings.secret) {
      setLastError('웹앱 URL과 공유 시크릿을 먼저 입력하세요.');
      return;
    }
    setOpStatus('testing');
    setLastError(null);
    try {
      const res = await testGasConnection(settings.gasUrl, settings.secret, settings.channel);
      if (res.ok) {
        update({ lastTestAt: new Date().toISOString() });
        if (settings.channel !== 'kakao' && res.results === undefined) setLastError(OLD_GAS_MESSAGE);
      } else {
        setLastError(res.error ?? '연결 테스트에 실패했습니다.');
      }
    } finally {
      setOpStatus('idle');
    }
  }, [settings.gasUrl, settings.secret, settings.channel, update]);

  const refreshStatus = useCallback(async () => {
    if (!settings.gasUrl || !settings.secret) {
      setLastError('웹앱 URL과 공유 시크릿을 먼저 입력하세요.');
      return;
    }
    setOpStatus('checking');
    setLastError(null);
    try {
      const res = await fetchGasStatus(settings.gasUrl, settings.secret);
      setGasStatus(res);
      if (!res.ok && res.error) setLastError(res.error);
    } finally {
      setOpStatus('idle');
    }
  }, [settings.gasUrl, settings.secret]);

  const setChannel = useCallback(async (channel: NotifyChannel) => {
    update({ channel });
    if (!settings.gasUrl || !settings.secret) return;
    // 채널은 GAS가 발송 출구를 고르는 기준이라 변경 즉시 반영해야 한다 — 사용자가 직접 고른 명시적 동작이므로
    // 자동 동기화 opt-in과 무관하게 새 채널이 실린 매니페스트를 바로 보낸다.
    const next: NotifyManifest = { ...manifest, channel };
    setOpStatus('syncing');
    setLastError(null);
    try {
      const res = await syncManifest(settings.gasUrl, settings.secret, next);
      if (res.ok) {
        update({ lastSyncAt: res.receivedAt ?? new Date().toISOString(), lastSyncHash: manifestHash(next) });
        if (channel !== 'kakao' && res.channel === undefined) setLastError(OLD_GAS_MESSAGE);
      } else {
        setLastError(res.error ?? '채널 변경 동기화에 실패했습니다.');
      }
    } finally {
      setOpStatus('idle');
    }
  }, [settings.gasUrl, settings.secret, manifest, update]);

  const connectTelegram = useCallback(async () => {
    if (!settings.gasUrl || !settings.secret) {
      setLastError('웹앱 URL과 공유 시크릿을 먼저 입력하세요.');
      return;
    }
    setOpStatus('connecting');
    setLastError(null);
    try {
      const res = await connectGasTelegram(settings.gasUrl, settings.secret);
      if (res.ok) {
        setTelegramConnect({ ok: true, chatName: res.chatName });
        await refreshStatus();
      } else {
        setTelegramConnect({ ok: false, chatName: res.chatName });
        setLastError(res.error && res.error.includes('알 수 없는 action') ? OLD_GAS_MESSAGE : (res.error ?? '텔레그램 연결에 실패했습니다.'));
      }
    } finally {
      setOpStatus('idle');
    }
  }, [settings.gasUrl, settings.secret, refreshStatus]);

  // opt-in 자동 동기화: 명시적으로 켠 사용자에 한해, 5초 디바운스 후 조용히 동기화한다.
  useEffect(() => {
    if (!settings.autoSync || !needsSync || !settings.gasUrl || !settings.secret) return;
    const timer = setTimeout(() => { void syncNow(); }, AUTO_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [settings.autoSync, needsSync, settings.gasUrl, settings.secret, syncNow]);

  return {
    settings,
    manifest,
    needsSync,
    opStatus,
    lastError,
    gasStatus,
    telegramConnect,
    setGasUrl: (url: string) => update({ gasUrl: url }),
    setSecret: (secret: string) => update({ secret }),
    setAutoSync: (on: boolean) => update({ autoSync: on }),
    setPyramidAlerts: (on: boolean) => update({ pyramidAlerts: on }),
    setChannel,
    connectTelegram,
    syncNow,
    testConnection,
    refreshStatus,
  };
}
