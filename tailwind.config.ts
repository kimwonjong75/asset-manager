import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    // Stage B — 색 클래스 문자열을 반환하는 순수 헬퍼(utils/directionTone 등)와 상수(smartFilterChips)
    './utils/**/*.ts',
    './constants/**/*.ts',
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
        // Stage B (가독성) — gray-500 오버라이드. Tailwind 기본 #6B7280은 이 앱의 카드 배경 위에서
        // 본문 대비가 WCAG AA(4.5:1)에 못 미쳤다: #121212 3.88 / #1E1E1E 3.45 / #2C2C2C 2.89.
        // #94949C → #121212 6.22 / #1E1E1E 5.54 / #2C2C2C 4.64 (세 배경 모두 AA 통과),
        // 그러면서 gray-400(#9CA3AF, 7.38/6.57/5.50)보다는 한 단계 어둡게 유지해 위계를 남긴다.
        // gray-600(#3A3A3A)은 텍스트로 쓰면 ~1.5:1이라 사실상 안 보인다 → `text-gray-600` 금지
        // (eslint.config.js no-restricted-syntax 가 차단, RULES.md §8). 테두리·배경용으로만 사용.
        // 기존 solid 채움(bg-gray-500 / hover:bg-gray-500, 흰 글자 버튼)은 밝아지면 대비가 떨어져
        // 원래 톤에 가까운 bg-zinc-500(#71717A)으로 교체했다.
        'gray-500': '#94949C',
        'gray-400': '#9CA3AF',
        primary: {
          DEFAULT: '#6366F1',
          light: '#818CF8',
          dark: '#4F46E5',
        },
        // ── 색 규약 (Stage B, 2026-09-14 사용자 확정 — RULES.md §8) ─────────────────────────
        //   빨강(up)   = 오름·이익·매수      파랑(down) = 내림·손실·매도
        //   주황(warning)+아이콘+문구 = 위험·긴급·확인   핑크(danger)+아이콘 = 삭제·오류
        // 빨강을 위험/삭제에 쓰지 않는 이유: "빨강=오름"과 뜻이 겹치면 초보자가 오판한다.
        // 대비(텍스트, #1E1E1E / #2C2C2C): up 6.03/5.05 · down 6.56/5.49 · flat 6.57/5.50 ·
        // ok 8.67/7.26 · info 7.78/6.52 · danger 6.29/5.27 — 모두 AA(4.5) 통과.
        up: {
          DEFAULT: '#F87171',
          soft: 'rgba(248, 113, 113, 0.15)',
        },
        down: {
          DEFAULT: '#60A5FA',
          soft: 'rgba(96, 165, 250, 0.15)',
        },
        flat: '#9CA3AF',
        /** "등록됨·저장됨·연결됨" 같은 성공 상태 전용 — 가격 방향에는 쓰지 않는다 */
        ok: {
          DEFAULT: '#34D399',
          soft: 'rgba(52, 211, 153, 0.15)',
        },
        /** 삭제·로그아웃 등 파괴적 동작과 오류 메시지 전용. 반드시 아이콘+명시 라벨과 함께 */
        danger: {
          DEFAULT: '#F472B6',
          soft: 'rgba(244, 114, 182, 0.15)',
          // 파괴적 버튼 채움 — 흰 글자 대비 6.04
          strong: '#BE185D',
        },
        /** @deprecated Stage B — 방향이면 up/down, 성공 상태면 ok 를 쓴다. 미이관 파일 호환용 별칭 */
        success: '#10B981',
        // P6 — 시맨틱 토큰(additive). 기존 gray-9xx 오버라이드와 동일한 헥사값을 의도가 드러나는
        // 이름으로 다시 노출한다(다크 전용, 기존 클래스는 전부 그대로 동작). 신규 코드가 대상.
        surface: '#121212',
        'surface-elevated': '#1E1E1E',
        'surface-muted': '#2C2C2C',
        'border-subtle': '#3A3A3A',
        /** @deprecated Stage B — up(오름·이익) 또는 ok(성공 상태)로 이관. 미이관 파일 호환용 별칭 */
        positive: {
          DEFAULT: '#10B981',
          soft: 'rgba(16, 185, 129, 0.15)',
        },
        /** @deprecated Stage B — down(내림·손실) / warning(위험) / danger(오류)로 이관. 호환용 별칭 */
        negative: {
          DEFAULT: '#EF4444',
          soft: 'rgba(239, 68, 68, 0.15)',
        },
        warning: {
          DEFAULT: '#F59E0B',
          soft: 'rgba(245, 158, 11, 0.15)',
        },
        // Stage B — 파랑(down)과 겹치지 않도록 sky 계열로 이동 (#3B82F6은 #2C2C2C에서 3.80로 AA 미달)
        info: {
          DEFAULT: '#38BDF8',
          soft: 'rgba(56, 189, 248, 0.15)',
        },
      },
      borderRadius: {
        // P6 카드 기본 반경(12px) — 기존 rounded-lg(8px) 사용처는 그대로 두고, 신규 공용 컴포넌트가 사용.
        card: '12px',
      },
      // Stage B — 전역 z-index 스케일 (RULES.md §8). 0~30은 컴포넌트 내부 로컬 레이어(sticky thead·인라인
      // 드롭다운)용 기본 숫자를 그대로 쓰고, 화면 전역 fixed/portal 레이어는 반드시 아래 토큰을 쓴다.
      zIndex: {
        nav: '40',      // BottomTabBar
        fab: '45',      // 맨 위로 버튼·하단 고정 액션 바
        popup: '50',    // AlertPopup(알림 브리핑)
        modal: '60',    // 모달·ChartViewerModal·MemoEditPopup·PortfolioAssistant
        menu: '70',     // ActionMenu(드롭다운·바텀시트)
        dialog: '80',   // ConfirmDialog(모달 위 확인창)
        banner: '85',   // App 상단 오류/새 버전 배너 — 모달 작업 중 오류도 보이게
        tooltip: '90',  // Tooltip·MemoTooltip
      },
    },
  },
  plugins: [],
};

export default config;

