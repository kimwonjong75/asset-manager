import React from 'react';
import AlertSettingsPage from './AlertSettingsPage';
import BackupSettingsSection from './BackupSettingsSection';
import CategorySettingsSection from './CategorySettingsSection';
import DisplaySettingsSection from './DisplaySettingsSection';
import AiSettingsSection from './AiSettingsSection';
import KakaoNotifySection from './settings/KakaoNotifySection';
import TurtleSettingsSection from './settings/TurtleSettingsSection';
import TurtleHoldingsSettingsSection from './settings/TurtleHoldingsSettingsSection';
import { SATELLITE_TURTLE_EVALUATION_ENABLED } from '../types/satelliteTurtleVisibility';

const SettingsPage: React.FC = () => {
  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <DisplaySettingsSection />
      <AiSettingsSection />
      <KakaoNotifySection />
      <TurtleHoldingsSettingsSection />
      {/* 옛 위성(투더문) 터틀 실행 설정 — "보유종목 터틀" 도입 이후 평가 자체가 꺼져 있어(P2)
          설정 화면에서도 숨긴다. 되돌리려면 types/satelliteTurtleVisibility.ts 상수 하나만 바꾸면 된다. */}
      {SATELLITE_TURTLE_EVALUATION_ENABLED && <TurtleSettingsSection />}
      <AlertSettingsPage />
      <BackupSettingsSection />
      <CategorySettingsSection />
    </div>
  );
};

export default SettingsPage;
