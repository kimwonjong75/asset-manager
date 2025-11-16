import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/asset-manager/', // GitHub Pages 저장소 이름에 맞게 변경하세요
      server: {
    port: 3000 // 원하는 포트로 변경 가능
      }
})
