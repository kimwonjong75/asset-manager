import React from 'react';
import AlertSettingsPage from './AlertSettingsPage';
import BackupSettingsSection from './BackupSettingsSection';
import CategorySettingsSection from './CategorySettingsSection';
import DisplaySettingsSection from './DisplaySettingsSection';

const SettingsPage: React.FC = () => {
  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <DisplaySettingsSection />
      <AlertSettingsPage />
      <BackupSettingsSection />
      <CategorySettingsSection />
    </div>
  );
};

export default SettingsPage;
