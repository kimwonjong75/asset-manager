import { useState, useCallback, useRef } from 'react';
import { googleDriveService } from '../services/googleDriveService';
import { BackupInfo, BackupSettings, DEFAULT_BACKUP_SETTINGS } from '../types/backup';

const LS_KEY_SETTINGS = 'asset-manager-backup-settings';
const LS_KEY_LAST_DATE = 'asset-manager-last-backup-date';
const BACKUP_PREFIX = 'portfolio_backup_';

function loadSettings(): BackupSettings {
  try {
    const stored = localStorage.getItem(LS_KEY_SETTINGS);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return DEFAULT_BACKUP_SETTINGS;
}

function saveSettings(s: BackupSettings) {
  localStorage.setItem(LS_KEY_SETTINGS, JSON.stringify(s));
}

function extractDateFromFileName(name: string): string {
  // portfolio_backup_2026-02-19.json → 2026-02-19
  const match = name.match(/portfolio_backup_(\d{4}-\d{2}-\d{2})\.json/);
  return match ? match[1] : '';
}

export function useBackup(deps: { isSignedIn: boolean }) {
  const [backupSettings, setBackupSettings] = useState<BackupSettings>(loadSettings);
  const [backupList, setBackupList] = useState<BackupInfo[]>([]);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const isRunningRef = useRef(false);

  const updateSettings = useCallback((s: BackupSettings) => {
    setBackupSettings(s);
    saveSettings(s);
  }, []);

  // 백업 수행 (데이터 JSON 문자열을 받아서 저장)
  const performBackup = useCallback(async (dataJson?: string) => {
    if (!deps.isSignedIn || isRunningRef.current) return;
    const settings = loadSettings();
    if (!settings.enabled) return;

    const today = new Date().toISOString().slice(0, 10);
    const lastDate = localStorage.getItem(LS_KEY_LAST_DATE);
    if (lastDate === today) return; // 이미 오늘 백업 완료

    isRunningRef.current = true;
    setIsBackingUp(true);
    try {
      // dataJson이 없으면 현재 portfolio.json을 로드하여 백업
      let content = dataJson;
      if (!content) {
        content = await googleDriveService.loadFile();
        if (!content) {
          console.log('[Backup] No portfolio data to backup');
          return;
        }
      }

      const fileName = `${BACKUP_PREFIX}${today}.json`;
      await googleDriveService.saveFile(content, fileName);
      localStorage.setItem(LS_KEY_LAST_DATE, today);
      console.log(`[Backup] 백업 완료: ${fileName}`);

      // retention cleanup
      await cleanupOldBackups(settings.retentionCount);
    } catch (err) {
      console.error('[Backup] 백업 실패:', err);
    } finally {
      isRunningRef.current = false;
      setIsBackingUp(false);
    }
  }, [deps.isSignedIn]);

  const cleanupOldBackups = async (retentionCount: number) => {
    try {
      const files = await googleDriveService.listFilesByPattern(BACKUP_PREFIX);
      const backups = files
        .map(f => ({ ...f, date: extractDateFromFileName(f.name) }))
        .filter(f => f.date)
        .sort((a, b) => b.date.localeCompare(a.date)); // 최신순

      if (backups.length > retentionCount) {
        const toDelete = backups.slice(retentionCount);
        for (const file of toDelete) {
          await googleDriveService.deleteFileById(file.id);
          console.log(`[Backup] 오래된 백업 삭제: ${file.name}`);
        }
      }
    } catch (err) {
      console.error('[Backup] Cleanup 실패:', err);
    }
  };

  // 백업 목록 조회
  const loadBackupList = useCallback(async () => {
    if (!deps.isSignedIn) return;
    setIsLoadingList(true);
    try {
      const files = await googleDriveService.listFilesByPattern(BACKUP_PREFIX);
      const list: BackupInfo[] = files
        .map(f => ({
          fileId: f.id,
          fileName: f.name,
          date: extractDateFromFileName(f.name),
          createdTime: f.createdTime,
        }))
        .filter(f => f.date)
        .sort((a, b) => b.date.localeCompare(a.date));
      setBackupList(list);
    } catch (err) {
      console.error('[Backup] 목록 조회 실패:', err);
    } finally {
      setIsLoadingList(false);
    }
  }, [deps.isSignedIn]);

  // 백업 복원 → 파싱된 JSON 반환 (호출측에서 updateAllData)
  const restoreBackup = useCallback(async (fileId: string): Promise<string | null> => {
    if (!deps.isSignedIn) return null;
    setIsRestoring(true);
    try {
      const content = await googleDriveService.loadFileById(fileId);
      return content;
    } catch (err) {
      console.error('[Backup] 복원 실패:', err);
      return null;
    } finally {
      setIsRestoring(false);
    }
  }, [deps.isSignedIn]);

  // 단일 백업 삭제
  const deleteBackup = useCallback(async (fileId: string) => {
    if (!deps.isSignedIn) return;
    try {
      await googleDriveService.deleteFileById(fileId);
      setBackupList(prev => prev.filter(b => b.fileId !== fileId));
    } catch (err) {
      console.error('[Backup] 삭제 실패:', err);
    }
  }, [deps.isSignedIn]);

  return {
    backupSettings,
    updateSettings,
    backupList,
    isBackingUp,
    isLoadingList,
    isRestoring,
    performBackup,
    loadBackupList,
    restoreBackup,
    deleteBackup,
  };
}
