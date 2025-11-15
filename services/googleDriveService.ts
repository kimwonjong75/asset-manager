// Google Drive API 서비스
// Google Identity Services를 사용한 OAuth 인증 및 Drive API 연동

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

class GoogleDriveService {
  private accessToken: string | null = null;
  private user: GoogleUser | null = null;
  private clientId: string | null = null;
  private tokenClient: google.accounts.oauth2.TokenClient | null = null;
  private isInitialized = false;

  // Google Identity Services 초기화
  async initialize(clientId: string): Promise<void> {
    if (this.isInitialized) return;
    
    this.clientId = clientId;
    
    // Google API 스크립트 로드
    await this.loadGoogleScripts();
    
    // 저장된 토큰 확인
    const savedToken = localStorage.getItem('google_drive_access_token');
    const savedUser = localStorage.getItem('google_drive_user');
    
    if (savedToken && savedUser) {
      this.accessToken = savedToken;
      this.user = JSON.parse(savedUser);
      // 토큰 유효성 검사
      if (await this.validateToken()) {
        this.isInitialized = true;
        return;
      } else {
        // 토큰이 만료된 경우
        this.accessToken = null;
        this.user = null;
        localStorage.removeItem('google_drive_access_token');
        localStorage.removeItem('google_drive_user');
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
              discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
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
      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId!,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: async (response: google.accounts.oauth2.TokenResponse) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }

          this.accessToken = response.access_token;
          
          // 사용자 정보 가져오기
          try {
            const userInfo = await this.getUserInfo();
            this.user = userInfo;
            localStorage.setItem('google_drive_access_token', this.accessToken);
            localStorage.setItem('google_drive_user', JSON.stringify(userInfo));
            resolve(userInfo);
          } catch (error) {
            reject(error);
          }
        },
      });

      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  // 사용자 정보 가져오기
  private async getUserInfo(): Promise<GoogleUser> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    const data = await response.json();
    return {
      email: data.email,
      name: data.name,
      picture: data.picture,
    };
  }

  // 로그아웃
  signOut(): void {
    if (this.accessToken) {
      window.google.accounts.oauth2.revoke(this.accessToken, () => {
        this.accessToken = null;
        this.user = null;
        localStorage.removeItem('google_drive_access_token');
        localStorage.removeItem('google_drive_user');
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

  // 파일 목록 가져오기
  async listFiles(): Promise<DriveFile[]> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=name="portfolio.json" and trashed=false',
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to list files');
    }

    const data = await response.json();
    return data.files || [];
  }

  // 파일 저장 (생성 또는 업데이트)
  async saveFile(content: string, fileName: string = 'portfolio.json'): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    // 기존 파일 확인
    const files = await this.listFiles();
    const existingFile = files.find(f => f.name === fileName);

    const fileContent = new Blob([content], { type: 'application/json' });
    const metadata = {
      name: fileName,
      mimeType: 'application/json',
    };

    if (existingFile) {
      // 파일 업데이트
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', fileContent);

      const response = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: form,
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update file');
      }
    } else {
      // 새 파일 생성
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', fileContent);

      const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: form,
        }
      );

      if (!response.ok) {
        throw new Error('Failed to create file');
      }
    }
  }

  // 파일 불러오기
  async loadFile(fileName: string = 'portfolio.json'): Promise<string | null> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    const files = await this.listFiles();
    const file = files.find(f => f.name === fileName);

    if (!file) {
      return null;
    }

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to load file');
    }

    return await response.text();
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
      };
    };
  }

  namespace google {
    namespace accounts {
      namespace oauth2 {
        interface TokenClient {
          requestAccessToken: (options?: { prompt?: string }) => void;
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
