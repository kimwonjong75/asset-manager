/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_GOOGLE_CLIENT_ID: string
    readonly VITE_CLOUD_RUN_BASE_URL?: string
    readonly VITE_DRIVE_FOLDER_ID?: string
  }
  
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }

  /** vite.config.ts `define`으로 빌드 시점에 주입되는 ISO 문자열(사용설명서 "앱 빌드 날짜" 표시용). */
  declare const __BUILD_TIME__: string;