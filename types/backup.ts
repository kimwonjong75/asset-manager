export interface BackupInfo {
  fileId: string;
  fileName: string;
  date: string;        // YYYY-MM-DD (파일명에서 추출)
  createdTime?: string;
}

export interface BackupSettings {
  enabled: boolean;
  retentionCount: number;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: true,
  retentionCount: 10,
};

export const RETENTION_OPTIONS = [3, 5, 7, 10] as const;
