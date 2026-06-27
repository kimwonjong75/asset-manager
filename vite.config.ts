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
      }
})