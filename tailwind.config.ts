import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './pages/**/*.{ts,tsx}',
    './sections/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans KR"', 'sans-serif'],
      },
      colors: {
        'gray-900': '#121212',
        'gray-800': '#1E1E1E',
        'gray-700': '#2C2C2C',
        'gray-600': '#3A3A3A',
        'gray-400': '#9CA3AF',
        primary: {
          DEFAULT: '#6366F1',
          light: '#818CF8',
          dark: '#4F46E5',
        },
        success: '#10B981',
        danger: '#EF4444',
        // P6 — 시맨틱 토큰(additive). 기존 gray-9xx 오버라이드와 동일한 헥사값을 의도가 드러나는
        // 이름으로 다시 노출한다(다크 전용, 기존 클래스는 전부 그대로 동작). 신규 코드가 대상.
        surface: '#121212',
        'surface-elevated': '#1E1E1E',
        'surface-muted': '#2C2C2C',
        'border-subtle': '#3A3A3A',
        positive: {
          DEFAULT: '#10B981',
          soft: 'rgba(16, 185, 129, 0.15)',
        },
        negative: {
          DEFAULT: '#EF4444',
          soft: 'rgba(239, 68, 68, 0.15)',
        },
        warning: {
          DEFAULT: '#F59E0B',
          soft: 'rgba(245, 158, 11, 0.15)',
        },
        info: {
          DEFAULT: '#3B82F6',
          soft: 'rgba(59, 130, 246, 0.15)',
        },
      },
      borderRadius: {
        // P6 카드 기본 반경(12px) — 기존 rounded-lg(8px) 사용처는 그대로 두고, 신규 공용 컴포넌트가 사용.
        card: '12px',
      },
    },
  },
  plugins: [],
};

export default config;

