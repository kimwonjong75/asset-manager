import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/asset-manager/', // 이 줄 추가 (저장소 이름과 일치해야 함)
  server: {
    port: 3000
  }
})