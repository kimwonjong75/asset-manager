import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 주의: GitHub Pages 배포 빌드는 Pages 전용으로 유지한다.
// Cloudflare Workers용 cloudflare() 플러그인을 여기에 섞으면
// wrangler/miniflare(Node>=22 요구)가 로드되면서 CI(Node 20) 빌드가 깨진다.
// Worker 배포는 wrangler.jsonc 단독 설정으로 분리한다.
export default defineConfig({
  plugins: [react()],
  base: '/asset-manager/', // GitHub Pages 저장소 이름에 맞게 변경하세요
      server: {
    port: 3000 // 원하는 포트로 변경 가능
      },
  // 사용설명서(manual 탭)가 "이 문서는 앱과 함께 자동 업데이트됨"을 보여줄 때 쓰는 빌드 시각.
  // 빌드 시점에 한 번 고정되는 상수 — 런타임에 바뀌지 않는다(vite-env.d.ts에 타입 선언).
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})