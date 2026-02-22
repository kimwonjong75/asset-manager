// Google Drive API 서비스
// Authorization Code Flow + Backend JWT를 사용한 OAuth 인증 및 Drive API 연동

import LZString from 'lz-string';

export interface GoogleUser {
  email: string;
  name: string;
  picture?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
}

const DRIVE_FOLDER_ID = '10O5cGNd9QVoAAxR8NdojqI9AD7wj0Q_g';
const AUTH_API_URL = 'https://asset-manager-887842923289.asia-northeast3.run.app';

class GoogleDriveService {
  private accessToken: string | null = null;
  private jwtToken: string | null = null;
  private user: GoogleUser | null = null;
  private clientId: string | null = null;
  private isInitialized = false;
  private folderId: string | null = DRIVE_FOLDER_ID;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshPromise: Promise<void> | null = null;
  private onAuthStateChange: ((signedIn: boolean) => void) | null = null;

  // UI 레이어에서 인증 상태 변경 콜백 등록
  setAuthStateChangeCallback(callback: (signedIn: boolean) => void): void {
    this.onAuthStateChange = callback;
  }

  // Google Identity Services 초기화
  async initialize(clientId: string): Promise<void> {
    if (this.isInitialized) return;

    this.clientId = clientId;

    // Google Identity Services 스크립트 로드
    await this.loadGoogleScripts();

    // 저장된 토큰 확인
    const savedJwt = localStorage.getItem('google_drive_jwt');
    const savedToken = localStorage.getItem('google_drive_access_token');
    const savedUser = localStorage.getItem('google_drive_user');
    const savedTokenExpiry = localStorage.getItem('google_drive_token_expiry');

    if (savedJwt && savedUser) {
      this.jwtToken = savedJwt;
      this.user = JSON.parse(savedUser);

      const now = Date.now();
      const expiryTime = savedTokenExpiry ? parseInt(savedTokenExpiry, 10) : 0;

      if (savedToken && expiryTime > now) {
        // Access Token이 아직 유효
        this.accessToken = savedToken;
        this.scheduleTokenRefresh(expiryTime - now);
        this.isInitialized = true;
        return;
      }

      // Access Token 만료 → 백엔드로 갱신 시도
      try {
        await this.refreshTokenViaBackend();
        this.isInitialized = true;
        return;
      } catch {
        console.log('Backend token refresh failed, user needs to sign in again');
      }

      // 갱신 실패 → 토큰 정리 (초기화 시에는 onAuthStateChange 호출하지 않음)
      this.jwtToken = null;
      this.user = null;
      this.accessToken = null;
      localStorage.removeItem('google_drive_jwt');
      localStorage.removeItem('google_drive_access_token');
      localStorage.removeItem('google_drive_user');
      localStorage.removeItem('google_drive_token_expiry');
    }

    this.isInitialized = true;
  }

  private loadGoogleScripts(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Google 로그인 (Authorization Code Flow)
  async signIn(): Promise<GoogleUser> {
    if (!this.clientId) {
      throw new Error('Google Drive service not initialized. Please provide client ID.');
    }

    return new Promise((resolve, reject) => {
      const codeClient = window.google.accounts.oauth2.initCodeClient({
        client_id: this.clientId!,
        scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid',
        ux_mode: 'popup',
        callback: async (response: google.accounts.oauth2.CodeResponse) => {
          if (response.error) {
            console.error('OAuth code error:', response.error);
            reject(new Error(response.error));
            return;
          }

          try {
            // Authorization Code를 백엔드로 전송 → JWT + Access Token 수신
            const authResponse = await fetch(`${AUTH_API_URL}/auth/callback`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: response.code }),
            });

            if (!authResponse.ok) {
              const errorData = await authResponse.json().catch(() => ({ error: 'Auth callback failed' }));
              throw new Error(errorData.error || 'Auth callback failed');
            }

            const data = await authResponse.json();

            this.jwtToken = data.jwt;
            this.accessToken = data.access_token;
            this.user = data.user;

            const expiresIn = (data.expires_in || 3600) * 1000;
            const expiryTime = Date.now() + expiresIn;

            localStorage.setItem('google_drive_jwt', this.jwtToken!);
            localStorage.setItem('google_drive_access_token', this.accessToken!);
            localStorage.setItem('google_drive_user', JSON.stringify(this.user));
            localStorage.setItem('google_drive_token_expiry', expiryTime.toString());

            this.scheduleTokenRefresh(expiresIn);
            resolve(this.user!);
          } catch (error) {
            console.error('Auth callback error:', error);
            reject(error);
          }
        },
        error_callback: (error: { type: string }) => {
          if (error.type === 'popup_closed') {
            reject(new Error('로그인이 취소되었습니다.'));
          } else {
            reject(new Error(`로그인 팝업 오류: ${error.type}`));
          }
        },
      });

      codeClient.requestCode();
    });
  }

  // 백엔드를 통한 Access Token 갱신 (Refresh Token 사용)
  private refreshTokenViaBackend(): Promise<void> {
    // 동시 갱신 요청 중복 방지
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.doRefreshToken().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async doRefreshToken(): Promise<void> {
    if (!this.jwtToken) throw new Error('No JWT token');

    const response = await fetch(`${AUTH_API_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.jwtToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Token refresh failed' }));
      throw new Error(errorData.error || 'Token refresh failed');
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    const expiresIn = (data.expires_in || 3600) * 1000;
    const expiryTime = Date.now() + expiresIn;

    localStorage.setItem('google_drive_access_token', this.accessToken!);
    localStorage.setItem('google_drive_token_expiry', expiryTime.toString());

    this.scheduleTokenRefresh(expiresIn);
  }

  // 토큰 만료 전 갱신 스케줄링
  private scheduleTokenRefresh(expiresInMs: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    const refreshTime = Math.max(0, expiresInMs - 5 * 60 * 1000); // 5분 전
    this.refreshTimer = setTimeout(() => {
      this.refreshTokenViaBackend().catch(() => {
        console.log('Scheduled token refresh failed');
        this.clearAuth();
      });
    }, refreshTime);
  }

  // 401 시 재인증: 백엔드를 통한 토큰 갱신 시도
  private async reAuthenticate(): Promise<void> {
    try {
      await this.refreshTokenViaBackend();
    } catch {
      this.clearAuth();
      throw new Error('Re-authentication failed');
    }
  }

  // 인증 정보 제거
  private clearAuth(): void {
    this.accessToken = null;
    this.jwtToken = null;
    this.user = null;
    localStorage.removeItem('google_drive_access_token');
    localStorage.removeItem('google_drive_jwt');
    localStorage.removeItem('google_drive_user');
    localStorage.removeItem('google_drive_token_expiry');
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.onAuthStateChange?.(false);
  }

  // 401 자동 재시도 fetch 래퍼
  private async authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    const doFetch = () => fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    const response = await doFetch();

    if (response.status === 401) {
      console.log('Got 401, attempting re-authentication...');
      await this.reAuthenticate();
      // 재인증 성공 — 원래 요청 재시도
      return doFetch();
    }

    return response;
  }

  // 로그아웃
  signOut(): void {
    // 백엔드에 Refresh Token 폐기 요청
    if (this.jwtToken) {
      fetch(`${AUTH_API_URL}/auth/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.jwtToken}`,
        },
      }).catch(() => {});
    }

    // Google Access Token revoke
    if (this.accessToken && window.google?.accounts?.oauth2?.revoke) {
      const token = this.accessToken;
      window.google.accounts.oauth2.revoke(token, () => {});
    }

    this.clearAuth();
  }

  // 로그인 상태 확인
  isSignedIn(): boolean {
    return this.accessToken !== null && this.user !== null;
  }

  // 현재 사용자 정보
  getCurrentUser(): GoogleUser | null {
    return this.user;
  }

  // 파일 목록 가져오기 (기본: portfolio.json)
  async listFiles(fileName: string = 'portfolio.json'): Promise<DriveFile[]> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    let query = `name = '${fileName}' and trashed = false`;
    if (this.folderId) {
      query += ` and '${this.folderId}' in parents`;
    }

    const searchParams = new URLSearchParams({
      q: query,
      spaces: 'drive',
      fields: 'files(id,name),nextPageToken',
      pageSize: '10',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });

    const response = await this.authenticatedFetch(
      `https://www.googleapis.com/drive/v3/files?${searchParams.toString()}`
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('Drive list files error', response.status, errorText);
      throw new Error(`Failed to list files (${response.status})`);
    }

    const data = await response.json();
    return data.files || [];
  }

  // 패턴으로 파일 목록 가져오기 (예: history_*.json)
  async listFilesByPattern(pattern: string): Promise<DriveFile[]> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    let query = `name contains '${pattern}' and trashed = false`;
    if (this.folderId) {
      query += ` and '${this.folderId}' in parents`;
    }

    const searchParams = new URLSearchParams({
      q: query,
      spaces: 'drive',
      fields: 'files(id,name,createdTime),nextPageToken',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });

    const response = await this.authenticatedFetch(
      `https://www.googleapis.com/drive/v3/files?${searchParams.toString()}`
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.files || [];
  }

  // 파일 저장 (생성 또는 업데이트) - LZ-String 압축 적용
  async saveFile(content: string, fileName: string = 'portfolio.json'): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    // 기존 파일 확인
    const files = await this.listFiles(fileName);
    const existingFile = files.find(f => f.name === fileName);

    // LZ-String UTF16 압축 적용
    const compressed = LZString.compressToUTF16(content);
    const fileContent = new Blob([compressed], { type: 'application/json' });
    const baseMetadata = {
      name: fileName,
      mimeType: 'application/json',
    };

    if (existingFile) {
      // 파일 업데이트
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(baseMetadata)], { type: 'application/json' }));
      form.append('file', fileContent);

      const response = await this.authenticatedFetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart&supportsAllDrives=true`,
        { method: 'PATCH', body: form }
      );

      if (!response.ok) {
        throw new Error('Failed to update file');
      }
    } else {
      // 새 파일 생성
      const metadata: { name: string; mimeType: string; parents?: string[] } = { ...baseMetadata };
      if (this.folderId) {
        metadata.parents = [this.folderId];
      }
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', fileContent);

      const response = await this.authenticatedFetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
        { method: 'POST', body: form }
      );

      if (!response.ok) {
        throw new Error('Failed to create file');
      }
    }
  }

  // 파일 불러오기 - LZ-String 압축 해제 및 레거시 호환
  async loadFile(fileName: string = 'portfolio.json'): Promise<string | null> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    const files = await this.listFiles(fileName);
    const file = files.find(f => f.name === fileName);

    if (!file) {
      return null;
    }

    const response = await this.authenticatedFetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('Drive load file error', response.status, errorText);
      throw new Error(`Failed to load file (${response.status})`);
    }

    const rawContent = await response.text();

    // LZ-String 압축 해제 시도 (레거시 호환: 압축 안 된 파일도 지원)
    try {
      const decompressed = LZString.decompressFromUTF16(rawContent);
      if (decompressed && decompressed.startsWith('{')) {
        return decompressed;
      }
    } catch {
      // 압축 해제 실패 시 원본 반환
    }

    // 압축되지 않은 레거시 데이터 그대로 반환
    return rawContent;
  }
  // 파일 ID로 직접 삭제
  async deleteFileById(fileId: string): Promise<void> {
    if (!this.accessToken) throw new Error('Not authenticated');
    const response = await this.authenticatedFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
      { method: 'DELETE' }
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete file (${response.status})`);
    }
  }

  // 파일 ID로 직접 로드 (백업 복원용)
  async loadFileById(fileId: string): Promise<string | null> {
    if (!this.accessToken) throw new Error('Not authenticated');
    const response = await this.authenticatedFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
    );
    if (!response.ok) return null;
    const rawContent = await response.text();
    try {
      const decompressed = LZString.decompressFromUTF16(rawContent);
      if (decompressed && decompressed.startsWith('{')) return decompressed;
    } catch { /* fallback */ }
    return rawContent;
  }
}

// 싱글톤 인스턴스
export const googleDriveService = new GoogleDriveService();

// 타입 선언
declare global {
  interface Window {
    google: {
      accounts: {
        oauth2: {
          initCodeClient: (config: {
            client_id: string;
            scope: string;
            ux_mode: 'popup' | 'redirect';
            callback: (response: google.accounts.oauth2.CodeResponse) => void;
            error_callback?: (error: { type: string }) => void;
            login_hint?: string;
            redirect_uri?: string;
          }) => google.accounts.oauth2.CodeClient;
          revoke: (token: string, callback: () => void) => void;
        };
      };
    };
  }

  namespace google {
    namespace accounts {
      namespace oauth2 {
        interface CodeClient {
          requestCode: () => void;
        }
        interface CodeResponse {
          code: string;
          scope: string;
          error?: string;
          error_description?: string;
          error_uri?: string;
        }
      }
    }
  }
}
