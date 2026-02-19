import React, { useEffect } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import { RETENTION_OPTIONS } from '../types/backup';

const BackupSettingsSection: React.FC = () => {
  const { derived, actions } = usePortfolio();
  const { backupList, backupSettings, isBackingUp } = derived;

  // 설정 탭 진입 시 백업 목록 로드
  useEffect(() => {
    actions.loadBackupList();
  }, []);

  const handleToggle = () => {
    actions.updateBackupSettings({ ...backupSettings, enabled: !backupSettings.enabled });
  };

  const handleRetentionChange = (count: number) => {
    actions.updateBackupSettings({ ...backupSettings, retentionCount: count });
  };

  const handleManualBackup = async () => {
    await actions.performBackup();
    actions.loadBackupList();
  };

  const handleRestore = async (fileId: string, date: string) => {
    if (!window.confirm(`${date} 백업으로 복원하면 현재 데이터가 대체됩니다. 계속하시겠습니까?`)) return;
    await actions.restoreBackup(fileId);
  };

  const handleDelete = async (fileId: string, date: string) => {
    if (!window.confirm(`${date} 백업을 삭제하시겠습니까?`)) return;
    await actions.deleteBackup(fileId);
  };

  const lastBackupDate = localStorage.getItem('asset-manager-last-backup-date');

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg">
      {/* 헤더 */}
      <div className="px-6 py-5 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">데이터 백업 설정</h2>
        <p className="text-gray-400 text-sm mt-1">Google Drive에 포트폴리오 데이터를 자동으로 백업하고 복원합니다.</p>
      </div>

      <div className="px-6 py-4 space-y-5">
        {/* 자동 백업 토글 */}
        <div className="flex items-center justify-between bg-gray-900 rounded-lg p-4">
          <div>
            <span className="text-white font-medium text-sm">자동 백업 (1일 1회)</span>
            <p className="text-gray-400 text-xs mt-0.5">시세 업데이트 시 자동으로 백업 파일을 생성합니다</p>
          </div>
          <button
            onClick={handleToggle}
            className={`flex-shrink-0 w-12 h-6 rounded-full transition-colors relative ${
              backupSettings.enabled ? 'bg-primary' : 'bg-gray-600'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                backupSettings.enabled ? 'left-6' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {/* 보관 개수 + 마지막 백업 + 수동 백업 */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-300">보관 개수:</label>
            <select
              value={backupSettings.retentionCount}
              onChange={(e) => handleRetentionChange(Number(e.target.value))}
              className="bg-gray-700 border border-gray-600 rounded-md py-1.5 px-2 text-white text-sm"
            >
              {RETENTION_OPTIONS.map(n => (
                <option key={n} value={n}>최근 {n}개</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">
              마지막 백업: {lastBackupDate || '없음'}
            </span>
            <button
              onClick={handleManualBackup}
              disabled={isBackingUp}
              className="text-sm px-3 py-1.5 bg-primary hover:bg-primary-dark text-white rounded-md transition disabled:opacity-50"
            >
              {isBackingUp ? '백업 중...' : '수동 백업'}
            </button>
          </div>
        </div>

        {/* 백업 목록 */}
        {backupList.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-2">백업 목록</h3>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {backupList.map((b) => (
                <div
                  key={b.fileId}
                  className="flex items-center justify-between bg-gray-900 rounded px-3 py-2"
                >
                  <span className="text-sm text-gray-200">{b.date}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRestore(b.fileId, b.date)}
                      className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded transition"
                    >
                      복원
                    </button>
                    <button
                      onClick={() => handleDelete(b.fileId, b.date)}
                      className="text-xs px-2 py-1 bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white rounded transition"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {backupList.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-4">저장된 백업이 없습니다.</p>
        )}
      </div>
    </div>
  );
};

export default BackupSettingsSection;
