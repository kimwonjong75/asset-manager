/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_GOOGLE_CLIENT_ID: string
    readonly VITE_CLOUD_RUN_BASE_URL?: string
    readonly VITE_DRIVE_FOLDER_ID?: string
  }
  
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }