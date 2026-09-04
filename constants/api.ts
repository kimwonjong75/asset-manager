// API URL 중앙 관리
// Cloud Run 서버 URL이 변경되면 이 파일만 수정하면 됩니다.

export const CLOUD_RUN_BASE_URL =
  import.meta.env?.VITE_CLOUD_RUN_BASE_URL ||
  'https://asset-manager-887842923289.asia-northeast3.run.app';

// 카카오톡 알림(GAS) 딥링크·매니페스트가 참조하는 공개 앱 URL(GitHub Pages).
// P4 딥링크 규약(?tab=today&asset=<id>)과 동일 오리진 — utils/deepLink.ts 참고.
export const APP_PUBLIC_URL =
  import.meta.env?.VITE_APP_PUBLIC_URL ||
  'https://kimwonjong75.github.io/asset-manager/';
