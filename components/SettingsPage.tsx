import React from 'react';
import AlertSettingsPage from './AlertSettingsPage';
import BackupSettingsSection from './BackupSettingsSection';
import CategorySettingsSection from './CategorySettingsSection';
import DisplaySettingsSection from './DisplaySettingsSection';
import AiSettingsSection from './AiSettingsSection';
import KakaoNotifySection from './settings/KakaoNotifySection';
import TurtleSettingsSection from './settings/TurtleSettingsSection';

const SettingsPage: React.FC = () => {
  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <DisplaySettingsSection />
      <AiSettingsSection />
      <KakaoNotifySection />
      <TurtleSettingsSection />
      <AlertSettingsPage />
      <BackupSettingsSection />
      <CategorySettingsSection />
    </div>
  );
};

export default SettingsPage;
