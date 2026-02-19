// Google Drive API 서비스
// Google Identity Services를 사용한 OAuth 인증 및 Drive API 연동

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

class GoogleDriveService {
  private accessToken: string | null = null;
  private user: GoogleUser | null = null;
  private clientId: string | null = null;
  private tokenClient: google.accounts.oauth2.TokenClient | null = null;
  private isInitialized = false;
  private folderId: string | null = DRIVE_FOLDER_ID;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private onAuthStateChange: ((signedIn: boolean) => void) | null = null;

  // UI 레이어에서 인증 상태 변경 콜백 등록
  setAuthStateChangeCallback(callback: (signedIn: boolean) => void): void {
    this.onAuthStateChange = callback;
  }

  // Google Identity Services 초기화
  async initialize(clientId: string): Promise<void> {
    if (this.isInitialized) return;
    
    this.clientId = clientId;
    
    // Google API 스크립트 로드
    await this.loadGoogleScripts();
    
    // 저장된 토큰 확인
    const savedToken = localStorage.getItem('google_drive_access_token');
    const savedUser = localStorage.getItem('google_drive_user');
    const savedTokenExpiry = localStorage.getItem('google_drive_token_expiry');
    
    if (savedToken && savedUser) {
      this.accessToken = savedToken;
      this.user = JSON.parse(savedUser);
      
      // 토큰 만료 시간 확인
      const now = Date.now();
      const expiryTime = savedTokenExpiry ? parseInt(savedTokenExpiry, 10) : 0;
      
      // 토큰이 만료되지 않았고 유효한 경우
      if (expiryTime > now && await this.validateToken()) {
        this.isInitialized = true;
        // 만료 전 자동 갱신 스케줄
        this.scheduleTokenRefresh(expiryTime - now);
        return;
      } else {
        // 토큰이 만료된 경우 - 자동 갱신 시도 (시간 제한 없이)
        if (savedUser) {
          try {
            await this.refreshTokenSilently();
            if (this.accessToken) {
              this.isInitialized = true;
              return;
            }
          } catch (error) {
            console.log('Silent token refresh failed, user needs to sign in again');
          }
        }
        // silent refresh 실패 시 토큰 정리
        this.accessToken = null;
        this.user = null;
        localStorage.removeItem('google_drive_access_token');
        localStorage.removeItem('google_drive_user');
        localStorage.removeItem('google_drive_token_expiry');
        // 초기화 시에는 onAuthStateChange 콜백을 호출하지 않음 (아직 UI가 마운트 전일 수 있음)
      }
    }
    
    this.isInitialized = true;
  }

  private loadGoogleScripts(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Google Identity Services 스크립트 로드
      if (window.google?.accounts) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        // Google API 클라이언트 라이브러리 로드
        const apiScript = document.createElement('script');
        apiScript.src = 'https://apis.google.com/js/api.js';
        apiScript.async = true;
        apiScript.defer = true;
        apiScript.onload = () => {
          window.gapi.load('client', () => {
            window.gapi.client.init({
              discoveryDocs: [
                'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
                'https://www.googleapis.com/discovery/v1/apis/oauth2/v2/rest'
              ],
            }).then(() => {
              resolve();
            }).catch(reject);
          });
        };
        apiScript.onerror = reject;
        document.head.appendChild(apiScript);
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Google 로그인
  async signIn(): Promise<GoogleUser> {
    if (!this.clientId) {
      throw new Error('Google Drive service not initialized. Please provide client ID.');
    }
    return new Promise((resolve, reject) => {
      console.log('=== Google Sign In 시작 ===');
      console.log('Client ID:', this.clientId);
      console.log('Requested scope:', 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid');

      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId!,
        scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid',
        callback: async (response: google.accounts.oauth2.TokenResponse) => {
          console.log('=== OAuth Callback 실행됨 ===');
          console.log('Response:', response);
          
          if (response.error) {
            console.error('OAuth error:', response.error);
            reject(new Error(response.error));
            return;
          }
    
          this.accessToken = response.access_token;
          console.log('Access token received');
          console.log('Received scope:', response.scope);
          console.log('Scope includes userinfo.email:', response.scope?.includes('userinfo.email'));
          console.log('Scope includes userinfo.profile:', response.scope?.includes('userinfo.profile'));
          
          // 토큰 만료 시간 저장 (기본 1시간, expires_in이 있으면 사용)
          const expiresIn = response.expires_in ? response.expires_in * 1000 : 3600 * 1000;
          const expiryTime = Date.now() + expiresIn;
          localStorage.setItem('google_drive_token_expiry', expiryTime.toString());
          
          // 사용자 정보 가져오기
          try {
            const userInfo = await this.getUserInfo();
            this.user = userInfo;
            localStorage.setItem('google_drive_access_token', this.accessToken);
            localStorage.setItem('google_drive_user', JSON.stringify(userInfo));
            
            // 만료 전 자동 갱신 스케줄
            this.scheduleTokenRefresh(expiresIn);

            resolve(userInfo);
          } catch (error: unknown) {
            console.error('Failed to get user info:', error);
            if (error instanceof Error) {
              console.error('Error details:', error.message, error.stack);
            }
            // 토큰은 받았지만 사용자 정보를 가져오지 못한 경우, 토큰을 저장하지 않음
            this.accessToken = null;
            reject(error);
          }
        },
      });
    
      // 이전 로그인 계정이 있으면 힌트 제공
      const savedUser = localStorage.getItem('google_drive_user');
      const hint = savedUser ? JSON.parse(savedUser).email : undefined;

      console.log('Requesting access token with prompt: select_account');
      this.tokenClient.requestAccessToken({
        prompt: 'select_account',
        login_hint: hint
      });
    });
  }

  // 사용자 정보 가져오기
  private async getUserInfo(): Promise<GoogleUser> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    try {
      // 방법 1: OAuth2 userinfo API 시도
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.email) {
          return {
            email: data.email,
            name: data.name || data.email.split('@')[0],
            picture: data.picture,
          };
        }
      }

      // 방법 2: Google API 클라이언트 사용 (대안)
      if (window.gapi?.client && window.gapi.client.setToken) {
        try {
          // 토큰 설정
          window.gapi.client.setToken({ access_token: this.accessToken });
          await window.gapi.client.load('oauth2', 'v2');
          const userInfo = await window.gapi.client.oauth2.userinfo.get();
          if (userInfo.result && userInfo.result.email) {
            return {
              email: userInfo.result.email,
              name: userInfo.result.name || userInfo.result.email.split('@')[0],
              picture: userInfo.result.picture,
            };
          }
        } catch (gapiError) {
          console.error('GAPI userinfo error:', gapiError);
        }
      }

      // 두 방법 모두 실패한 경우
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('User info API error:', response.status, errorText);
      
      // 더 자세한 에러 메시지
      if (response.status === 401) {
        throw new Error('인증 실패: Google Cloud Console의 OAuth 동의 화면에서 userinfo.email과 userinfo.profile scope를 추가했는지 확인하세요.');
      } else if (response.status === 403) {
        throw new Error('권한 없음: 사용자 정보에 접근할 권한이 없습니다. scope 설정을 확인하세요.');
      } else {
        throw new Error(`사용자 정보를 가져올 수 없습니다 (${response.status}): ${errorText}`);
      }
    } catch (error: unknown) {
      console.error('getUserInfo error:', error);
      throw error;
    }
  }

  // 토큰 자동 갱신 (조용히) - Promise로 콜백 완료까지 대기
  private refreshTokenSilently(): Promise<void> {
    if (!this.clientId || !this.user) return Promise.reject(new Error('No client or user'));

    return new Promise((resolve, reject) => {
      try {
        this.tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: this.clientId!,
          scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid',
          callback: (response: google.accounts.oauth2.TokenResponse) => {
            if (response.error) {
              console.log('Token refresh failed:', response.error);
              reject(new Error(response.error));
              return;
            }

            this.accessToken = response.access_token;
            const expiresIn = response.expires_in ? response.expires_in * 1000 : 3600 * 1000;
            const expiryTime = Date.now() + expiresIn;
            localStorage.setItem('google_drive_access_token', this.accessToken);
            localStorage.setItem('google_drive_token_expiry', expiryTime.toString());

            // 다음 갱신 스케줄
            this.scheduleTokenRefresh(expiresIn);
            resolve();
          },
        });

        // prompt: 'none'으로 조용히 갱신 시도
        this.tokenClient.requestAccessToken({ prompt: 'none' });
      } catch (error) {
        console.log('Silent token refresh error:', error);
        reject(error);
      }
    });
  }

  // 토큰 만료 전 갱신 스케줄링
  private scheduleTokenRefresh(expiresInMs: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    const refreshTime = Math.max(0, expiresInMs - 5 * 60 * 1000); // 5분 전
    this.refreshTimer = setTimeout(() => {
      this.refreshTokenSilently().catch(() => {
        console.log('Scheduled token refresh failed');
      });
    }, refreshTime);
  }

  // 401 시 재인증: silent refresh → 실패 시 popup 재로그인
  private reAuthenticate(): Promise<void> {
    // 1차: silent refresh 시도
    return this.refreshTokenSilently().catch(() => {
      // 2차: popup 재로그인 (사용자 인터랙션 필요)
      console.log('Silent refresh failed, attempting popup re-login...');
      return new Promise<void>((resolve, reject) => {
        if (!this.clientId) {
          reject(new Error('No client ID'));
          return;
        }

        this.tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: this.clientId!,
          scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid',
          callback: (response: google.accounts.oauth2.TokenResponse) => {
            if (response.error) {
              // 팝업도 실패 — 완전히 로그아웃 처리
              this.clearAuth();
              reject(new Error('Re-authentication failed'));
              return;
            }

            this.accessToken = response.access_token;
            const expiresIn = response.expires_in ? response.expires_in * 1000 : 3600 * 1000;
            const expiryTime = Date.now() + expiresIn;
            localStorage.setItem('google_drive_access_token', this.accessToken);
            localStorage.setItem('google_drive_token_expiry', expiryTime.toString());
            this.scheduleTokenRefresh(expiresIn);
            resolve();
          },
        });

        const hint = this.user?.email;
        this.tokenClient.requestAccessToken({
          prompt: '',
          login_hint: hint
        });
      });
    });
  }

  // 인증 정보 제거
  private clearAuth(): void {
    this.accessToken = null;
    this.user = null;
    localStorage.removeItem('google_drive_access_token');
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
    if (this.accessToken) {
      const token = this.accessToken;
      this.clearAuth();
      window.google.accounts.oauth2.revoke(token, () => {
        // revoke 완료
      });
    }
  }

  // 로그인 상태 확인
  isSignedIn(): boolean {
    return this.accessToken !== null && this.user !== null;
  }

  // 현재 사용자 정보
  getCurrentUser(): GoogleUser | null {
    return this.user;
  }

  // 토큰 유효성 검사
  private async validateToken(): Promise<boolean> {
    if (!this.accessToken) return false;

    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + this.accessToken);
      return response.ok;
    } catch {
      return false;
    }
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
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: google.accounts.oauth2.TokenResponse) => void;
          }) => google.accounts.oauth2.TokenClient;
          revoke: (token: string, callback: () => void) => void;
        };
      };
    };
    gapi: {
      load: (api: string, callback: () => void) => void;
      client: {
        init: (config: {
          discoveryDocs: string[];
        }) => Promise<void>;
        setToken: (token: { access_token: string }) => void;
        load: (apiName: string, version: string) => Promise<void>;
        oauth2: {
          userinfo: {
            get: () => Promise<{ result: { email?: string; name?: string; picture?: string } }>;
          };
        };
      };
    };
  }

  namespace google {
    namespace accounts {
      namespace oauth2 {
        interface TokenClient {
          requestAccessToken: (options?: { prompt?: string; login_hint?: string }) => void;
        }
        interface TokenResponse {
          access_token: string;
          expires_in: number;
          scope: string;
          token_type: string;
          error?: string;
        }
      }
    }
  }
}
