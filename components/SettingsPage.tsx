import React, { useRef, useState } from 'react';
import AlertSettingsPage from './AlertSettingsPage';
import BackupSettingsSection from './BackupSettingsSection';
import CategorySettingsSection from './CategorySettingsSection';
import DisplaySettingsSection from './DisplaySettingsSection';
import AiSettingsSection from './AiSettingsSection';
import KakaoNotifySection from './settings/KakaoNotifySection';
import TurtleSettingsSection from './settings/TurtleSettingsSection';
import TurtleHoldingsSettingsSection from './settings/TurtleHoldingsSettingsSection';
import { SATELLITE_TURTLE_EVALUATION_ENABLED } from '../types/satelliteTurtleVisibility';
import { SETTINGS_TABS, type SettingsTabId } from '../utils/settingsTabs';
import { readSettingsTab, writeSettingsTab } from './settings/settingsTabStore';

/**
 * 설정 화면 — 섹션을 하위 탭 4개로 나눠 보여준다(utils/settingsTabs).
 * 비활성 탭도 **언마운트하지 않고 hidden으로만 숨긴다**: '터틀 규칙' 등은 로컬 draft를 들고 있어
 * 탭을 오가다 저장 전 입력이 사라지면 안 되기 때문.
 */
const SettingsPage: React.FC = () => {
  const [tab, setTab] = useState<SettingsTabId>(readSettingsTab);
  const tabRefs = useRef<Partial<Record<SettingsTabId, HTMLButtonElement | null>>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const select = (id: SettingsTabId, focus = false) => {
    setTab(id);
    writeSettingsTab(id);
    if (focus) tabRefs.current[id]?.focus();
    // 아래로 스크롤해 탭바가 상단에 붙어 있던 상태라면 새 탭을 맨 위부터 보여준다
    // (안 그러면 이전 탭의 스크롤 위치 그대로 새 탭 중간이 보인다).
    const root = rootRef.current;
    const bar = barRef.current;
    if (root && bar && root.getBoundingClientRect().top < bar.getBoundingClientRect().top) {
      root.scrollIntoView({ block: 'start' });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const n = SETTINGS_TABS.length;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    const target = next === null ? undefined : SETTINGS_TABS[next];
    if (target) {
      e.preventDefault();
      select(target.id, true);
    }
  };

  const panel = (id: SettingsTabId, children: React.ReactNode) => (
    <div
      role="tabpanel"
      id={`settings-panel-${id}`}
      aria-labelledby={`settings-tab-${id}`}
      hidden={tab !== id}
      className="space-y-8"
    >
      {children}
    </div>
  );

  const current = SETTINGS_TABS.find(t => t.id === tab);

  return (
    <div ref={rootRef} className="space-y-4 max-w-3xl mx-auto">
      <div ref={barRef} className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur pt-1 pb-2">
        <div role="tablist" aria-label="설정 분류" className="flex gap-1 border-b border-gray-700 overflow-x-auto">
          {SETTINGS_TABS.map((t, i) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                ref={el => { tabRefs.current[t.id] = el; }}
                type="button"
                role="tab"
                id={`settings-tab-${t.id}`}
                aria-selected={active}
                aria-controls={`settings-panel-${t.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => select(t.id)}
                onKeyDown={e => onKeyDown(e, i)}
                className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-primary text-white font-semibold'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {current && <p className="text-xs text-gray-500 mt-2 px-1">{current.hint}</p>}
      </div>

      {panel('alerts', <>
        <KakaoNotifySection />
        <AlertSettingsPage />
      </>)}
      {panel('turtle', <>
        <TurtleHoldingsSettingsSection />
        {/* 옛 위성(투더문) 터틀 실행 설정 — "보유종목 터틀" 도입 이후 평가 자체가 꺼져 있어(P2)
            설정 화면에서도 숨긴다. 되돌리려면 types/satelliteTurtleVisibility.ts 상수 하나만 바꾸면 된다. */}
        {SATELLITE_TURTLE_EVALUATION_ENABLED && <TurtleSettingsSection />}
      </>)}
      {panel('display', <>
        <DisplaySettingsSection />
        <CategorySettingsSection />
      </>)}
      {panel('data', <>
        <AiSettingsSection />
        <BackupSettingsSection />
      </>)}
    </div>
  );
};

export default SettingsPage;
