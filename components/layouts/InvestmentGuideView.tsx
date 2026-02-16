import React, { useState, useRef, useEffect } from 'react';

const SECTIONS = [
  { id: 'signal', label: '매매 시그널' },
  { id: 'ma', label: '이동평균선' },
  { id: 'rsi', label: 'RSI 지표' },
  { id: 'filter', label: '스마트 필터' },
  { id: 'strategy', label: '실전 활용법' },
  { id: 'tips', label: '투자 원칙' },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

/* ─── 아이콘 SVG ─── */
const Icons = {
  signal: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
  ma: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
    </svg>
  ),
  rsi: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  filter: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
    </svg>
  ),
  strategy: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  tips: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
} as const;

const SECTION_COLORS: Record<SectionId, { border: string; bg: string; text: string; badge: string }> = {
  signal:   { border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-400', badge: 'bg-emerald-500' },
  ma:       { border: 'border-blue-500/40',    bg: 'bg-blue-500/10',    text: 'text-blue-400',    badge: 'bg-blue-500' },
  rsi:      { border: 'border-purple-500/40',  bg: 'bg-purple-500/10',  text: 'text-purple-400',  badge: 'bg-purple-500' },
  filter:   { border: 'border-amber-500/40',   bg: 'bg-amber-500/10',   text: 'text-amber-400',   badge: 'bg-amber-500' },
  strategy: { border: 'border-rose-500/40',    bg: 'bg-rose-500/10',    text: 'text-rose-400',    badge: 'bg-rose-500' },
  tips:     { border: 'border-cyan-500/40',    bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    badge: 'bg-cyan-500' },
};

const InvestmentGuideView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SectionId>('signal');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id as SectionId);
          }
        }
      },
      { rootMargin: '-20% 0px -60% 0px' }
    );
    for (const ref of Object.values(sectionRefs.current)) {
      if (ref) observer.observe(ref);
    }
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: SectionId) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const SectionHeader: React.FC<{ id: SectionId; title: string }> = ({ id, title }) => {
    const c = SECTION_COLORS[id];
    return (
      <div className={`flex items-center gap-3 mb-5 pb-3 border-b ${c.border}`}>
        <div className={`p-2 rounded-lg ${c.bg} ${c.text}`}>
          {Icons[id]}
        </div>
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>
    );
  };

  return (
    <div className="flex gap-6">
      {/* ─── TOC 사이드바 ─── */}
      <nav className="hidden lg:block w-48 shrink-0 sticky top-8 self-start">
        <div className="bg-gray-800/80 border border-gray-700 rounded-xl p-3 space-y-1">
          <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider mb-2 px-2">목차</p>
          {SECTIONS.map(s => {
            const isActive = activeSection === s.id;
            const c = SECTION_COLORS[s.id];
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2
                  ${isActive
                    ? `${c.bg} ${c.text} font-semibold`
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                  }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${isActive ? c.badge : 'bg-gray-600'}`} />
                {s.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ─── 본문 ─── */}
      <div className="flex-1 min-w-0 space-y-8">

        {/* 모바일 TOC */}
        <div className="lg:hidden flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
          {SECTIONS.map(s => {
            const isActive = activeSection === s.id;
            const c = SECTION_COLORS[s.id];
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition-all
                  ${isActive ? `${c.badge} text-white` : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* ━━━━━━━━━━ 1. 매매 시그널 ━━━━━━━━━━ */}
        <section
          id="signal"
          ref={el => { sectionRefs.current['signal'] = el; }}
          className="bg-gray-800/60 border border-gray-700 rounded-xl p-5 sm:p-6"
        >
          <SectionHeader id="signal" title="매매 시그널 — 점수 체계" />

          <p className="text-sm text-gray-300 mb-4">
            서버에서 각 종목(주식·ETF)의 <span className="text-emerald-400 font-semibold">현재가, MA20, MA60, RSI</span>를 분석해
            점수를 합산하여 매매 시그널을 생성합니다. 시작 점수는 <span className="font-mono text-white">0</span>점입니다.
          </p>

          {/* 점수 요소 카드 */}
          <div className="grid sm:grid-cols-3 gap-3 mb-5">
            <div className="bg-gray-900/80 rounded-lg p-4 border border-gray-600/30">
              <h4 className="text-xs font-bold text-blue-400 mb-2">현재가 vs MA20</h4>
              <div className="space-y-1.5 text-xs text-gray-300">
                <div className="flex justify-between"><span>현재가 &gt; MA20 (20일선 위)</span><span className="text-green-400 font-bold">+1.0</span></div>
                <div className="flex justify-between"><span>현재가 &lt; MA20 (20일선 아래)</span><span className="text-red-400 font-bold">-1.0</span></div>
              </div>
            </div>
            <div className="bg-gray-900/80 rounded-lg p-4 border border-gray-600/30">
              <h4 className="text-xs font-bold text-purple-400 mb-2">MA20 vs MA60 (배열)</h4>
              <div className="space-y-1.5 text-xs text-gray-300">
                <div className="flex justify-between"><span>MA20 &gt; MA60 (정배열)</span><span className="text-green-400 font-bold">+0.5</span></div>
                <div className="flex justify-between"><span>MA20 &le; MA60 (역배열)</span><span className="text-red-400 font-bold">-0.5</span></div>
              </div>
            </div>
            <div className="bg-gray-900/80 rounded-lg p-4 border border-gray-600/30">
              <h4 className="text-xs font-bold text-amber-400 mb-2">RSI (14일)</h4>
              <div className="space-y-1.5 text-xs text-gray-300">
                <div className="flex justify-between"><span>RSI &lt; 30 (과매도)</span><span className="text-green-400 font-bold">+0.5</span></div>
                <div className="flex justify-between"><span>RSI &gt; 70 (과매수)</span><span className="text-red-400 font-bold">-0.5</span></div>
                <div className="flex justify-between"><span>30 ~ 70 (정상)</span><span className="text-gray-500 font-bold">0</span></div>
              </div>
            </div>
          </div>

          {/* 시그널 판정 테이블 */}
          <h4 className="text-sm font-bold text-white mb-3">최종 시그널 판정</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2 px-3">합산 점수</th>
                  <th className="text-left py-2 px-3">시그널</th>
                  <th className="text-left py-2 px-3">의미</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                <tr className="border-b border-gray-700/50">
                  <td className="py-2 px-3 font-mono">+1.5 이상</td>
                  <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-green-600 text-white text-[11px] font-bold">강한 매수</span></td>
                  <td className="py-2 px-3">상승 추세 + 정배열 + 과매도 등 여러 지표 동시 매수 신호</td>
                </tr>
                <tr className="border-b border-gray-700/50">
                  <td className="py-2 px-3 font-mono">+0.5 이상</td>
                  <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-emerald-500 text-white text-[11px] font-bold">매수</span></td>
                  <td className="py-2 px-3">기술적으로 상승 가능성이 높은 상태</td>
                </tr>
                <tr className="border-b border-gray-700/50">
                  <td className="py-2 px-3 font-mono">-0.5 ~ +0.5</td>
                  <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-gray-600 text-white text-[11px] font-bold">중립</span></td>
                  <td className="py-2 px-3">뚜렷한 방향성 없음 — 관망</td>
                </tr>
                <tr className="border-b border-gray-700/50">
                  <td className="py-2 px-3 font-mono">-0.5 이하</td>
                  <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-red-500 text-white text-[11px] font-bold">매도</span></td>
                  <td className="py-2 px-3">기술적으로 하락 가능성이 높은 상태</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-mono">-1.5 이하</td>
                  <td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-red-700 text-white text-[11px] font-bold">강한 매도</span></td>
                  <td className="py-2 px-3">하락 추세 + 역배열 + 과매수 등 여러 지표 동시 매도 신호</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 예시 */}
          <div className="mt-5 grid sm:grid-cols-2 gap-3">
            <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-4">
              <p className="text-xs font-bold text-green-400 mb-2">예시: 강한 매수 (+2.0)</p>
              <div className="font-mono text-xs text-gray-300 space-y-1">
                <p>현재가 50,000 &gt; MA20 48,000 &nbsp;<span className="text-green-400">+1.0</span></p>
                <p>MA20 48,000 &gt; MA60 45,000 &nbsp;<span className="text-green-400">+0.5</span></p>
                <p>RSI = 25 (과매도) &nbsp;<span className="text-green-400">+0.5</span></p>
                <p className="pt-1 border-t border-green-700/30 font-bold text-white">= +2.0 → 강한 매수</p>
              </div>
            </div>
            <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-4">
              <p className="text-xs font-bold text-red-400 mb-2">예시: 강한 매도 (-2.0)</p>
              <div className="font-mono text-xs text-gray-300 space-y-1">
                <p>현재가 40,000 &lt; MA20 45,000 &nbsp;<span className="text-red-400">-1.0</span></p>
                <p>MA20 45,000 &lt; MA60 50,000 &nbsp;<span className="text-red-400">-0.5</span></p>
                <p>RSI = 75 (과매수) &nbsp;<span className="text-red-400">-0.5</span></p>
                <p className="pt-1 border-t border-red-700/30 font-bold text-white">= -2.0 → 강한 매도</p>
              </div>
            </div>
          </div>

          <div className="mt-4 bg-yellow-900/20 border border-yellow-600/30 rounded-lg px-4 py-3">
            <p className="text-xs text-yellow-300">
              <span className="font-bold">참고:</span> 암호화폐(코인)는 서버에서 MA를 계산하지 않아 항상 "중립"으로 표시됩니다. 스마트 필터에서는 프론트엔드가 별도 계산하므로 MA/RSI 필터를 사용할 수 있습니다.
            </p>
          </div>
        </section>

        {/* ━━━━━━━━━━ 2. 이동평균선 ━━━━━━━━━━ */}
        <section
          id="ma"
          ref={el => { sectionRefs.current['ma'] = el; }}
          className="bg-gray-800/60 border border-gray-700 rounded-xl p-5 sm:p-6"
        >
          <SectionHeader id="ma" title="이동평균선 (MA) 해석법" />

          <p className="text-sm text-gray-300 mb-4">
            이동평균선은 일정 기간의 <span className="text-blue-400 font-semibold">종가 평균</span>을 이은 선입니다.
            주가가 이 선 위에 있으면 상승 추세, 아래면 하락 추세로 판단합니다.
          </p>

          <div className="grid sm:grid-cols-2 gap-3 mb-5">
            <div className="bg-gray-900/80 rounded-lg p-4 border border-gray-600/30">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-1 rounded bg-red-500" />
                <h4 className="text-sm font-bold text-red-400">MA20 (20일선)</h4>
              </div>
              <p className="text-xs text-gray-400">단기 추세를 나타냅니다. "최근 한 달간의 평균 가격"으로, 빠르게 반응합니다.</p>
            </div>
            <div className="bg-gray-900/80 rounded-lg p-4 border border-gray-600/30">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-1 rounded bg-blue-500" />
                <h4 className="text-sm font-bold text-blue-400">MA60 (60일선)</h4>
              </div>
              <p className="text-xs text-gray-400">중기 추세를 나타냅니다. "최근 3개월간의 평균 가격"으로, 큰 흐름을 보여줍니다.</p>
            </div>
          </div>

          <h4 className="text-sm font-bold text-white mb-3">핵심 패턴</h4>
          <div className="space-y-3">
            <div className="flex gap-3 items-start bg-green-900/15 rounded-lg p-3 border border-green-700/20">
              <span className="text-green-400 text-lg font-bold mt-0.5">+</span>
              <div>
                <p className="text-sm font-semibold text-green-400">정배열 (MA20 &gt; MA60)</p>
                <p className="text-xs text-gray-400 mt-0.5">단기 평균이 장기 평균보다 높은 상태 → 상승 추세가 확립된 것. 보유 유지 또는 매수 고려.</p>
              </div>
            </div>
            <div className="flex gap-3 items-start bg-red-900/15 rounded-lg p-3 border border-red-700/20">
              <span className="text-red-400 text-lg font-bold mt-0.5">−</span>
              <div>
                <p className="text-sm font-semibold text-red-400">역배열 (MA20 &lt; MA60)</p>
                <p className="text-xs text-gray-400 mt-0.5">단기 평균이 장기 평균보다 낮은 상태 → 하락 추세. 매도 고려 또는 매수 보류.</p>
              </div>
            </div>
            <div className="flex gap-3 items-start bg-emerald-900/15 rounded-lg p-3 border border-emerald-700/20">
              <span className="text-emerald-400 text-lg mt-0.5">★</span>
              <div>
                <p className="text-sm font-semibold text-emerald-400">골든크로스 (역배열 → 정배열 전환)</p>
                <p className="text-xs text-gray-400 mt-0.5">MA20이 MA60을 아래에서 위로 돌파. <span className="text-white font-medium">강력한 매수 신호</span> — 하락에서 상승으로 추세 전환.</p>
              </div>
            </div>
            <div className="flex gap-3 items-start bg-orange-900/15 rounded-lg p-3 border border-orange-700/20">
              <span className="text-orange-400 text-lg mt-0.5">★</span>
              <div>
                <p className="text-sm font-semibold text-orange-400">데드크로스 (정배열 → 역배열 전환)</p>
                <p className="text-xs text-gray-400 mt-0.5">MA20이 MA60을 위에서 아래로 돌파. <span className="text-white font-medium">강력한 매도 신호</span> — 상승에서 하락으로 추세 전환.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ━━━━━━━━━━ 3. RSI ━━━━━━━━━━ */}
        <section
          id="rsi"
          ref={el => { sectionRefs.current['rsi'] = el; }}
          className="bg-gray-800/60 border border-gray-700 rounded-xl p-5 sm:p-6"
        >
          <SectionHeader id="rsi" title="RSI (상대강도지수) 해석법" />

          <p className="text-sm text-gray-300 mb-4">
            RSI는 최근 14일간 상승과 하락의 <span className="text-purple-400 font-semibold">상대적 강도</span>를 0~100으로 나타낸 지표입니다.
            "얼마나 많이 올랐는가/떨어졌는가"를 수치로 보여줍니다.
          </p>

          {/* RSI 게이지 시각화 */}
          <div className="mb-5 bg-gray-900/80 rounded-lg p-4 border border-gray-600/30">
            <div className="flex items-center gap-1 text-[10px] text-gray-500 mb-1">
              <span>0</span>
              <span className="flex-1" />
              <span>30</span>
              <span className="flex-1" />
              <span>70</span>
              <span className="flex-1" />
              <span>100</span>
            </div>
            <div className="flex h-6 rounded-lg overflow-hidden">
              <div className="bg-blue-600/70 flex-[30] flex items-center justify-center">
                <span className="text-[10px] text-white font-bold">과매도</span>
              </div>
              <div className="bg-gray-600/70 flex-[40] flex items-center justify-center">
                <span className="text-[10px] text-white font-bold">정상 구간</span>
              </div>
              <div className="bg-yellow-600/70 flex-[30] flex items-center justify-center">
                <span className="text-[10px] text-white font-bold">과매수</span>
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 mb-5">
            <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
              <p className="text-sm font-bold text-blue-400 mb-1">RSI &le; 30 (과매도)</p>
              <p className="text-xs text-gray-400">"너무 많이 떨어졌다." 매도 압력이 과도해 반등 가능성이 높습니다. 분할 매수 고려.</p>
            </div>
            <div className="bg-gray-700/30 border border-gray-600/30 rounded-lg p-4">
              <p className="text-sm font-bold text-gray-300 mb-1">30 &lt; RSI &lt; 70 (정상)</p>
              <p className="text-xs text-gray-400">정상 범위. 추세 방향은 이동평균선과 함께 판단합니다.</p>
            </div>
            <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-4">
              <p className="text-sm font-bold text-yellow-400 mb-1">RSI &ge; 70 (과매수)</p>
              <p className="text-xs text-gray-400">"너무 많이 올랐다." 매수 압력이 과도해 조정(하락) 가능성이 높습니다. 분할 매도 고려.</p>
            </div>
          </div>

          <h4 className="text-sm font-bold text-white mb-3">전환 시그널 (스마트 필터)</h4>
          <div className="space-y-2">
            <div className="flex gap-3 items-start bg-blue-900/15 rounded-lg p-3 border border-blue-700/20">
              <span className="text-blue-400 font-bold text-sm">↑</span>
              <div>
                <p className="text-sm font-semibold text-blue-400">RSI 반등 (어제 &le;30 → 오늘 &gt;30)</p>
                <p className="text-xs text-gray-400 mt-0.5">과매도 영역을 탈출하기 시작. 바닥을 찍고 반등하는 신호 → 매수 타이밍 탐색.</p>
              </div>
            </div>
            <div className="flex gap-3 items-start bg-yellow-900/15 rounded-lg p-3 border border-yellow-700/20">
              <span className="text-yellow-400 font-bold text-sm">↓</span>
              <div>
                <p className="text-sm font-semibold text-yellow-400">RSI 과열진입 (어제 &lt;70 → 오늘 &ge;70)</p>
                <p className="text-xs text-gray-400 mt-0.5">과매수 영역에 진입. 과열 시작 신호 → 매도 타이밍 탐색.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ━━━━━━━━━━ 4. 스마트 필터 ━━━━━━━━━━ */}
        <section
          id="filter"
          ref={el => { sectionRefs.current['filter'] = el; }}
          className="bg-gray-800/60 border border-gray-700 rounded-xl p-5 sm:p-6"
        >
          <SectionHeader id="filter" title="스마트 필터 사용법" />

          <div className="bg-amber-900/15 border border-amber-700/20 rounded-lg p-4 mb-5">
            <p className="text-sm font-bold text-amber-400 mb-2">필터 조합 규칙</p>
            <div className="text-xs text-gray-300 space-y-1.5">
              <p><span className="text-amber-300 font-semibold">같은 그룹 내:</span> OR 논리 — 하나라도 해당되면 표시</p>
              <p><span className="text-amber-300 font-semibold">다른 그룹 간:</span> AND 논리 — 모든 그룹 조건 충족 시 표시</p>
              <p className="text-gray-400 mt-2">예: <span className="bg-gray-700 px-1.5 py-0.5 rounded text-blue-300">골든크로스</span> + <span className="bg-gray-700 px-1.5 py-0.5 rounded text-purple-300">RSI 반등</span> → MA그룹 AND RSI그룹 교집합</p>
            </div>
          </div>

          {/* 4개 그룹 */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* MA 그룹 */}
            <div className="bg-gray-900/80 rounded-lg p-4 border border-blue-600/20">
              <h4 className="text-xs font-bold text-blue-400 mb-3 flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                이동평균 (MA) 그룹
              </h4>
              <div className="space-y-2 text-xs text-gray-300">
                <div><span className="font-semibold text-white">현재가 &gt; 단기MA</span> — 가격이 단기 이동평균 위 (단기 상승)</div>
                <div><span className="font-semibold text-white">현재가 &gt; 장기MA</span> — 가격이 장기 이동평균 위 (장기 상승)</div>
                <div><span className="font-semibold text-white">정배열</span> — 단기MA &gt; 장기MA (상승 추세)</div>
                <div><span className="font-semibold text-white">역배열</span> — 단기MA &lt; 장기MA (하락 추세)</div>
                <div><span className="font-semibold text-white">골든크로스</span> — 어제 역배열 → 오늘 정배열 전환</div>
                <div><span className="font-semibold text-white">데드크로스</span> — 어제 정배열 → 오늘 역배열 전환</div>
                <p className="text-gray-500 mt-1">* 드롭다운에서 단기(10/20/60), 장기(60/120/200) 기간 선택 가능</p>
              </div>
            </div>

            {/* RSI 그룹 */}
            <div className="bg-gray-900/80 rounded-lg p-4 border border-purple-600/20">
              <h4 className="text-xs font-bold text-purple-400 mb-3 flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-purple-500" />
                RSI 그룹
              </h4>
              <div className="space-y-2 text-xs text-gray-300">
                <div><span className="font-semibold text-white">과매수 (RSI &ge; 70)</span> — 과열 구간, 매도 고려</div>
                <div><span className="font-semibold text-white">과매도 (RSI &le; 30)</span> — 침체 구간, 매수 고려</div>
                <div><span className="font-semibold text-white">RSI 반등</span> — 과매도 탈출 (어제 &le;30 → 오늘 &gt;30)</div>
                <div><span className="font-semibold text-white">RSI 과열진입</span> — 과매수 진입 (어제 &lt;70 → 오늘 &ge;70)</div>
              </div>
            </div>

            {/* 매매신호 그룹 */}
            <div className="bg-gray-900/80 rounded-lg p-4 border border-emerald-600/20">
              <h4 className="text-xs font-bold text-emerald-400 mb-3 flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                매매신호 그룹
              </h4>
              <div className="space-y-2 text-xs text-gray-300">
                <div><span className="px-1.5 py-0.5 rounded bg-green-600 text-white text-[10px] font-bold">강한 매수</span> — 서버 분석 점수 +1.5 이상</div>
                <div><span className="px-1.5 py-0.5 rounded bg-emerald-500 text-white text-[10px] font-bold">매수</span> — 서버 분석 점수 +0.5 이상</div>
                <div><span className="px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold">매도</span> — 서버 분석 점수 -0.5 이하</div>
                <div><span className="px-1.5 py-0.5 rounded bg-red-700 text-white text-[10px] font-bold">강한 매도</span> — 서버 분석 점수 -1.5 이하</div>
              </div>
            </div>

            {/* 포트폴리오 그룹 */}
            <div className="bg-gray-900/80 rounded-lg p-4 border border-amber-600/20">
              <h4 className="text-xs font-bold text-amber-400 mb-3 flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                포트폴리오 그룹
              </h4>
              <div className="space-y-2 text-xs text-gray-300">
                <div><span className="font-semibold text-white">수익중</span> — 현재 수익률 &gt; 0%</div>
                <div><span className="font-semibold text-white">손실중</span> — 현재 수익률 &lt; 0%</div>
                <div><span className="font-semibold text-white">고점대비 하락</span> — 52주 최고가 대비 설정 비율(%) 이상 하락</div>
                <div className="pt-1.5 border-t border-gray-700/50">
                  <span className="font-semibold text-yellow-400">매도 알림</span> — 52주 최고가 대비 설정 비율 이상 하락 시 경고 배지 표시 (종목별/전체 설정 가능)
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ━━━━━━━━━━ 5. 실전 활용법 ━━━━━━━━━━ */}
        <section
          id="strategy"
          ref={el => { sectionRefs.current['strategy'] = el; }}
          className="bg-gray-800/60 border border-gray-700 rounded-xl p-5 sm:p-6"
        >
          <SectionHeader id="strategy" title="실전 활용법 — 필터 조합 시나리오" />

          {/* 매수 시나리오 */}
          <div className="mb-6">
            <h4 className="text-sm font-bold text-green-400 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
              매수 타이밍 찾기
            </h4>
            <div className="space-y-3">
              <div className="bg-green-900/15 border border-green-700/20 rounded-lg p-4">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[11px] font-medium">골든크로스</span>
                  <span className="text-gray-500 text-xs">+</span>
                  <span className="px-2 py-0.5 rounded-full bg-purple-600 text-white text-[11px] font-medium">RSI 반등↑</span>
                </div>
                <p className="text-xs text-gray-300">하락→상승 추세 전환 + 과매도 탈출 = <span className="text-green-400 font-semibold">가장 강력한 매수 신호</span></p>
              </div>
              <div className="bg-green-900/15 border border-green-700/20 rounded-lg p-4">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[11px] font-medium">정배열</span>
                  <span className="text-gray-500 text-xs">+</span>
                  <span className="px-2 py-0.5 rounded-full bg-purple-600 text-white text-[11px] font-medium">과매도</span>
                </div>
                <p className="text-xs text-gray-300">상승 추세 유지 중 일시적 조정 = <span className="text-green-400 font-semibold">눌림목 매수 기회</span></p>
              </div>
              <div className="bg-green-900/15 border border-green-700/20 rounded-lg p-4">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[11px] font-medium">강한 매수</span>
                  <span className="text-gray-500 text-xs">+</span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-600 text-white text-[11px] font-medium">손실중</span>
                </div>
                <p className="text-xs text-gray-300">기술적으로 매수 신호인데 내 매입가보다 낮은 상태 = <span className="text-green-400 font-semibold">물타기(추가매수) 고려</span></p>
              </div>
            </div>
          </div>

          {/* 매도 시나리오 */}
          <div className="mb-6">
            <h4 className="text-sm font-bold text-red-400 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
              매도 타이밍 찾기
            </h4>
            <div className="space-y-3">
              <div className="bg-red-900/15 border border-red-700/20 rounded-lg p-4">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[11px] font-medium">데드크로스</span>
                  <span className="text-gray-500 text-xs">+</span>
                  <span className="px-2 py-0.5 rounded-full bg-purple-600 text-white text-[11px] font-medium">RSI 과열진입↓</span>
                </div>
                <p className="text-xs text-gray-300">상승→하락 추세 전환 + 과매수 진입 = <span className="text-red-400 font-semibold">가장 강력한 매도 신호</span></p>
              </div>
              <div className="bg-red-900/15 border border-red-700/20 rounded-lg p-4">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="px-2 py-0.5 rounded-full bg-purple-600 text-white text-[11px] font-medium">과매수</span>
                  <span className="text-gray-500 text-xs">+</span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-600 text-white text-[11px] font-medium">수익중</span>
                </div>
                <p className="text-xs text-gray-300">과열 상태 + 이미 수익 중 = <span className="text-red-400 font-semibold">수익 실현 타이밍</span></p>
              </div>
              <div className="bg-red-900/15 border border-red-700/20 rounded-lg p-4">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[11px] font-medium">역배열</span>
                  <span className="text-gray-500 text-xs">+</span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-600 text-white text-[11px] font-medium">고점대비 하락</span>
                </div>
                <p className="text-xs text-gray-300">하락 추세 + 고점 대비 큰 폭 하락 = <span className="text-red-400 font-semibold">손절 검토</span></p>
              </div>
            </div>
          </div>

          {/* 관망 시나리오 */}
          <div>
            <h4 className="text-sm font-bold text-gray-400 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              관망 (매수 금지)
            </h4>
            <div className="bg-gray-700/30 border border-gray-600/30 rounded-lg p-4">
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[11px] font-medium">역배열</span>
                <span className="text-gray-500 text-xs">+</span>
                <span className="px-2 py-0.5 rounded-full bg-purple-600 text-white text-[11px] font-medium">과매도</span>
              </div>
              <p className="text-xs text-gray-300">하락 추세 + 계속 하락 중 = <span className="text-gray-300 font-semibold">"떨어지는 칼날을 잡지 마라"</span> — 추세 전환(골든크로스/RSI반등) 확인 후 매수</p>
            </div>
          </div>
        </section>

        {/* ━━━━━━━━━━ 6. 투자 원칙 ━━━━━━━━━━ */}
        <section
          id="tips"
          ref={el => { sectionRefs.current['tips'] = el; }}
          className="bg-gray-800/60 border border-gray-700 rounded-xl p-5 sm:p-6"
        >
          <SectionHeader id="tips" title="투자 원칙 & 주의사항" />

          <div className="space-y-3">
            <div className="flex gap-3 items-start">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-cyan-400 text-sm font-bold">1</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">시그널은 확률이지, 확정이 아닙니다</p>
                <p className="text-xs text-gray-400 mt-0.5">"강한 매수"가 떠도 100% 오른다는 보장은 없습니다. 여러 지표가 같은 방향을 가리킬 때 신뢰도가 높아집니다.</p>
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-cyan-400 text-sm font-bold">2</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">분할 매수/매도를 습관화하세요</p>
                <p className="text-xs text-gray-400 mt-0.5">한 번에 전량 매수/매도하지 말고 3~4회로 나눠서 진입/청산하세요. 타이밍을 완벽하게 맞추는 것은 불가능합니다.</p>
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-cyan-400 text-sm font-bold">3</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">큰 추세(배열)를 먼저 확인하세요</p>
                <p className="text-xs text-gray-400 mt-0.5">정배열이면 매수 위주, 역배열이면 관망/매도 위주로 전략을 잡으세요. 역배열에서의 매수는 고위험입니다.</p>
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-cyan-400 text-sm font-bold">4</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">매도 알림(손절)을 반드시 설정하세요</p>
                <p className="text-xs text-gray-400 mt-0.5">고점 대비 하락률을 설정해두면 큰 손실을 방지할 수 있습니다. 기본값은 20%이며, 종목 특성에 따라 조정하세요.</p>
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-cyan-400 text-sm font-bold">5</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">단일 지표보다 조합을 신뢰하세요</p>
                <p className="text-xs text-gray-400 mt-0.5">RSI만 보거나 MA만 보지 말고, 스마트 필터에서 여러 그룹의 필터를 조합하세요. 교차 확인(Cross-confirmation)이 핵심입니다.</p>
              </div>
            </div>
          </div>

          <div className="mt-6 bg-gray-900/80 border border-gray-600/30 rounded-lg px-4 py-3">
            <p className="text-xs text-gray-400">
              <span className="text-cyan-400 font-semibold">면책 조항:</span> 이 앱의 모든 시그널과 지표는 기술적 분석에 기반한 <span className="text-white">참고 정보</span>이며, 투자 결정의 최종 책임은 사용자 본인에게 있습니다.
              기업의 실적, 뉴스, 시장 상황 등 기술적 분석 외의 요인도 반드시 함께 고려하세요.
            </p>
          </div>
        </section>

      </div>
    </div>
  );
};

export default InvestmentGuideView;
