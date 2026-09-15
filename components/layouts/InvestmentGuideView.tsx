import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowDown, ArrowUp, ChartColumn, ChartLine, ClipboardCheck, Eye, Inbox, Info, Lightbulb,
  ListFilter, OctagonAlert, ShieldCheck, Star, TrendingDown, TrendingUp, TriangleAlert,
} from 'lucide-react';
import KnowledgeInboxPanel from '../knowledge/KnowledgeInboxPanel';
import { getDefaultMAColor } from '../../utils/maCalculations';
import { CATEGORY_PALETTE } from '../../utils/chartFormat';

// Stage C 색 규약 (RULES.md §8) — 이 화면은 정적 교육 UI.
//   · 섹션 구분 색(teal/sky/purple/cyan…)은 폐지 → 중립 표면 + 아이콘. 상태 색을 장식에 쓰지 않는다.
//   · 매수 방향(가점·매수 신호·상승 추세)=up(빨강) / 매도 방향(감점·매도 신호·하락 추세)=down(파랑).
//   · 과열·과매도 구간·실수·물타기 경고=warning(주황)+아이콘 / 참고 안내=info+아이콘.
//   · MA 선 견본은 실제 차트 기본 식별 색(utils/maCalculations)을 그대로 쓴다.

const SECTIONS = [
  { id: 'inbox', label: '지식 인제스트' },
  { id: 'tradePlan', label: '매매 계획' },
  { id: 'signal', label: '매매 시그널' },
  { id: 'ma', label: '이동평균선' },
  { id: 'rsi', label: 'RSI 지표' },
  { id: 'filter', label: '스마트 필터' },
  { id: 'strategy', label: '실전 활용법' },
  { id: 'tips', label: '투자 원칙' },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

const ICON_CLS = 'w-5 h-5';
const Icons: Record<SectionId, React.ReactNode> = {
  inbox: <Inbox className={ICON_CLS} aria-hidden="true" />,
  tradePlan: <ClipboardCheck className={ICON_CLS} aria-hidden="true" />,
  signal: <TrendingUp className={ICON_CLS} aria-hidden="true" />,
  ma: <ChartLine className={ICON_CLS} aria-hidden="true" />,
  rsi: <ChartColumn className={ICON_CLS} aria-hidden="true" />,
  filter: <ListFilter className={ICON_CLS} aria-hidden="true" />,
  strategy: <Lightbulb className={ICON_CLS} aria-hidden="true" />,
  tips: <ShieldCheck className={ICON_CLS} aria-hidden="true" />,
};

// 표면 토큰 (Stage C — 카드 그림자 없음)
const SECTION_CLS = 'bg-surface-elevated border border-border-subtle rounded-card p-5 sm:p-6';
const INNER_CLS = 'bg-surface-muted rounded-lg p-4 border border-border-subtle';
const ROW_CLS = 'flex gap-3 items-start bg-surface-muted rounded-lg p-3 border border-border-subtle';
// 필터 칩(이름 표시용) — 필터 이름에는 의미 색을 입히지 않는다
const CHIP_CLS = 'px-2 py-0.5 rounded-full bg-surface-elevated border border-border-subtle text-gray-200 text-xs font-medium';

// 서버 매매 시그널 배지 — 매수=up / 매도=down. 강한 신호는 채움(-strong + 흰 글자), 일반은 soft.
// (구) "매도" 배지가 bg-red-500 이었다 — 빨강=매수 규약과 정반대라 버그로 교정.
const SIGNAL_BADGE = {
  strongBuy: 'bg-up-strong text-white',
  buy: 'bg-up-soft text-up',
  neutral: 'bg-surface-muted text-gray-300 border border-border-subtle',
  sell: 'bg-down-soft text-down',
  strongSell: 'bg-down-strong text-white',
} as const;

// 모듈 스코프 — 렌더 안에서 정의하면 매 렌더 새 컴포넌트(react-hooks/static-components).
// 공용 components/common/SectionHeader(건수·접기용)와 이름이 겹치지 않게 GuideSectionHeader.
const GuideSectionHeader: React.FC<{ id: SectionId; title: string }> = ({ id, title }) => (
  <div className="flex items-center gap-3 mb-5 pb-3 border-b border-border-subtle">
    <div className="p-2 rounded-lg bg-surface-muted text-gray-300">
      {Icons[id]}
    </div>
    <h2 className="text-base font-semibold text-white">{title}</h2>
  </div>
);

const ScoreRow: React.FC<{ label: string; score: string; tone: 'up' | 'down' | 'flat' }> = ({ label, score, tone }) => (
  <div className="flex justify-between gap-2">
    <span>{label}</span>
    <span className={`font-bold font-mono ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-gray-400'}`}>{score}</span>
  </div>
);

const InvestmentGuideView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SectionId>('inbox');
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

  return (
    <div className="flex gap-6">
      {/* ─── TOC 사이드바 ─── */}
      <nav className="hidden lg:block w-48 shrink-0 sticky top-8 self-start" aria-label="투자 가이드 목차">
        <div className="bg-surface-elevated border border-border-subtle rounded-card p-3 space-y-1">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2 px-2">목차</p>
          {SECTIONS.map(s => {
            const isActive = activeSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2
                  ${isActive
                    ? 'bg-surface-muted text-white font-semibold'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-surface-muted/60'
                  }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-primary-light' : 'bg-gray-600'}`} />
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
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                aria-current={isActive ? 'true' : undefined}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition-all
                  ${isActive ? 'bg-primary-dark text-white' : 'bg-surface-muted text-gray-400 hover:bg-gray-600'}`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* ━━━━━━━━━━ 0. 지식 인제스트 (승인 큐) ━━━━━━━━━━ */}
        <section
          id="inbox"
          ref={el => { sectionRefs.current['inbox'] = el; }}
          className={SECTION_CLS}
        >
          <GuideSectionHeader id="inbox" title="지식 인제스트 — 승인 큐" />
          <KnowledgeInboxPanel />
        </section>

        {/* ━━━━━━━━━━ 0.5 매매 계획 ━━━━━━━━━━ */}
        <section
          id="tradePlan"
          ref={el => { sectionRefs.current['tradePlan'] = el; }}
          className={SECTION_CLS}
        >
          <GuideSectionHeader id="tradePlan" title="매매 계획 — 사기 전에 팔 때를 먼저 정한다" />

          <p className="text-sm text-gray-300 mb-4">
            강환국 강의 템플릿을 그대로 앱 기능으로 옮긴 것이 "매매 계획"입니다. 자세한 설계는{' '}
            <code className="text-xs bg-surface-muted px-1.5 py-0.5 rounded text-gray-200">docs/매매계획_설계.md</code>에 있습니다.
          </p>

          {/* 강의 원칙 5개 */}
          <h4 className="text-sm font-bold text-white mb-3">강의 원칙 5가지</h4>
          <div className="space-y-2 mb-6">
            {[
              '사기 전에 매도 계획부터 세운다 — 손절선·익절선·추세선을 매수와 동시에 정한다',
              '1R(종목당 최대 허용손실)을 먼저 정하고 그 안에서 수량을 역산한다',
              '손절가를 매수 전에 미리 확정해 둔다 — 오른 뒤 급하게 정하지 않는다',
              '물타기(내려갈 때 추가매수)는 하지 않는다 — 불타기는 오를 때만, 그것도 옵션(기본 꺼짐)',
              '목표가에서 일부(절반) 먼저 팔아 이익을 확정하고, 나머지는 추세선을 이탈할 때 판다',
            ].map((rule, i) => (
              <div key={i} className={ROW_CLS}>
                <span className="text-gray-300 text-sm font-bold mt-0.5 font-mono">{i + 1}</span>
                <p className="text-xs text-gray-300">{rule}</p>
              </div>
            ))}
          </div>

          {/* 용어 4개 + 숫자 예시 — TradePlanCard 선 표기와 동일: 손절=warning+OctagonAlert(위험) /
              익절·불타기=up / 추세선 이탈 매도=down+TrendingDown */}
          <h4 className="text-sm font-bold text-white mb-3">용어 4가지 — 10,000원에 샀다면</h4>
          <div className="grid sm:grid-cols-2 gap-3 mb-6">
            <div className={INNER_CLS}>
              <h5 className="text-xs font-bold text-warning mb-1 flex items-center gap-1"><OctagonAlert className="h-3.5 w-3.5" aria-hidden="true" />손절선 — 9,300원</h5>
              <p className="text-xs text-gray-400">여기 오면 전량 매도. 손절폭 7%를 기본값으로 씁니다(10,000×0.93).</p>
            </div>
            <div className={INNER_CLS}>
              <h5 className="text-xs font-bold text-up mb-1 flex items-center gap-1"><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />익절선 — 12,100원</h5>
              <p className="text-xs text-gray-400">여기 오면 절반 매도. 손절폭의 3배(+21%)가 기본값입니다(10,000×1.21).</p>
            </div>
            <div className={INNER_CLS}>
              <h5 className="text-xs font-bold text-down mb-1 flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />추세선 — 20일 평균가</h5>
              <p className="text-xs text-gray-400">매일 조금씩 바뀝니다. 종가가 이 선 아래로 내려오면 나머지 전량을 매도합니다.</p>
            </div>
            <div className={INNER_CLS}>
              <h5 className="text-xs font-bold text-up mb-1 flex items-center gap-1"><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />불타기선 — 11,000 / 12,100 / 13,310원</h5>
              <p className="text-xs text-gray-400">+10%씩 오를 때마다 추가매수를 검토(옵션, 기본 꺼짐). 내려갈 때 사는 물타기는 이 앱에서 할 수 없습니다.</p>
            </div>
          </div>

          {/* 자주 하는 실수 5개 — 위험 경고(warning+아이콘) */}
          <h4 className="text-sm font-bold text-white mb-3">자주 하는 실수 5가지</h4>
          <div className="space-y-2 mb-6">
            {[
              '손절 미루기 — "조금만 더 기다리면 오르겠지"가 손실을 키우는 가장 흔한 원인입니다',
              '물타기 — 손실 중인 종목에 더 사는 것은 손실 확정을 미룰 뿐, 계획에 없는 행동입니다',
              '익절 전량 매도 — 한 번에 다 팔면 계속 오를 때의 이익을 놓칩니다. 절반만 먼저 팝니다',
              '추세선 이탈을 장중 가격만 보고 판단 — 확정 종가로만 판정합니다(장중 변동은 참고용)',
              '계획 없이 매수 — 계획이 없으면 알림도, 기준도 없습니다. 사기 전에 먼저 계획을 만드세요',
            ].map((mistake, i) => (
              <div key={i} className="flex gap-3 items-start bg-warning-soft rounded-lg p-3 border border-warning/20">
                <TriangleAlert className="h-4 w-4 text-warning shrink-0 mt-px" aria-hidden="true" />
                <p className="text-xs text-gray-300">{mistake}</p>
              </div>
            ))}
          </div>

          <div className="bg-surface-muted border border-border-subtle rounded-lg px-4 py-3">
            <p className="text-xs text-gray-400">
              <span className="text-gray-200 font-semibold">근거(백테스트 요약):</span> 이 규칙을 그대로 적용하면 최대 하락폭(MDD)은 크게 줄지만,
              수익률(CAGR)은 그냥 매수 후 보유(B&amp;H)보다 낮았습니다. 추세선은 20일선보다 50일선이 대체로 우월했고(휩쏘가 적음),
              불타기는 아직 검증되지 않았습니다(기본값 꺼짐). <span className="text-white font-medium">투자자문이 아닙니다</span> — 큰 손실을 막고
              정해 둔 규칙대로 실행하도록 돕는 도구입니다.
            </p>
          </div>
        </section>

        {/* ━━━━━━━━━━ 1. 매매 시그널 ━━━━━━━━━━ */}
        <section
          id="signal"
          ref={el => { sectionRefs.current['signal'] = el; }}
          className={SECTION_CLS}
        >
          <GuideSectionHeader id="signal" title="매매 시그널 — 점수 체계" />

          <p className="text-sm text-gray-300 mb-4">
            서버에서 각 종목(주식·ETF)의 <span className="text-gray-100 font-semibold">현재가, MA20, MA60, RSI</span>를 분석해
            점수를 합산하여 매매 시그널을 생성합니다. 시작 점수는 <span className="font-mono text-white">0</span>점입니다.
            <span className="text-up font-semibold"> + 점수는 매수 쪽</span>, <span className="text-down font-semibold">− 점수는 매도 쪽</span>으로 기웁니다.
          </p>

          {/* 점수 요소 카드 */}
          <div className="grid sm:grid-cols-3 gap-3 mb-5">
            <div className={INNER_CLS}>
              <h4 className="text-xs font-bold text-gray-100 mb-2">현재가 vs MA20</h4>
              <div className="space-y-1.5 text-xs text-gray-300">
                <ScoreRow label="현재가 > MA20 (20일선 위)" score="+1.0" tone="up" />
                <ScoreRow label="현재가 < MA20 (20일선 아래)" score="-1.0" tone="down" />
              </div>
            </div>
            <div className={INNER_CLS}>
              <h4 className="text-xs font-bold text-gray-100 mb-2">MA20 vs MA60 (배열)</h4>
              <div className="space-y-1.5 text-xs text-gray-300">
                <ScoreRow label="MA20 > MA60 (정배열)" score="+0.5" tone="up" />
                <ScoreRow label="MA20 ≤ MA60 (역배열)" score="-0.5" tone="down" />
              </div>
            </div>
            <div className={INNER_CLS}>
              <h4 className="text-xs font-bold text-gray-100 mb-2">RSI (14일)</h4>
              <div className="space-y-1.5 text-xs text-gray-300">
                <ScoreRow label="RSI < 30 (과매도)" score="+0.5" tone="up" />
                <ScoreRow label="RSI > 70 (과매수)" score="-0.5" tone="down" />
                <ScoreRow label="30 ~ 70 (정상)" score="0" tone="flat" />
              </div>
            </div>
          </div>

          {/* 시그널 판정 테이블 */}
          <h4 className="text-sm font-bold text-white mb-3">최종 시그널 판정</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-border-subtle">
                  <th className="text-left py-2 px-3">합산 점수</th>
                  <th className="text-left py-2 px-3">시그널</th>
                  <th className="text-left py-2 px-3">의미</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                <tr className="border-b border-border-subtle/60">
                  <td className="py-2 px-3 font-mono">+1.5 이상</td>
                  <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${SIGNAL_BADGE.strongBuy}`}>강한 매수</span></td>
                  <td className="py-2 px-3">상승 추세 + 정배열 + 과매도 등 여러 지표 동시 매수 신호</td>
                </tr>
                <tr className="border-b border-border-subtle/60">
                  <td className="py-2 px-3 font-mono">+0.5 이상</td>
                  <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${SIGNAL_BADGE.buy}`}>매수</span></td>
                  <td className="py-2 px-3">기술적으로 상승 가능성이 높은 상태</td>
                </tr>
                <tr className="border-b border-border-subtle/60">
                  <td className="py-2 px-3 font-mono">-0.5 ~ +0.5</td>
                  <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${SIGNAL_BADGE.neutral}`}>중립</span></td>
                  <td className="py-2 px-3">뚜렷한 방향성 없음 — 관망</td>
                </tr>
                <tr className="border-b border-border-subtle/60">
                  <td className="py-2 px-3 font-mono">-0.5 이하</td>
                  <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${SIGNAL_BADGE.sell}`}>매도</span></td>
                  <td className="py-2 px-3">기술적으로 하락 가능성이 높은 상태</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-mono">-1.5 이하</td>
                  <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${SIGNAL_BADGE.strongSell}`}>강한 매도</span></td>
                  <td className="py-2 px-3">하락 추세 + 역배열 + 과매수 등 여러 지표 동시 매도 신호</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 예시 */}
          <div className="mt-5 grid sm:grid-cols-2 gap-3">
            <div className={INNER_CLS}>
              <p className="text-xs font-bold text-up mb-2">예시: 강한 매수 (+2.0)</p>
              <div className="font-mono text-xs text-gray-300 space-y-1">
                <p>현재가 50,000 &gt; MA20 48,000 &nbsp;<span className="text-up">+1.0</span></p>
                <p>MA20 48,000 &gt; MA60 45,000 &nbsp;<span className="text-up">+0.5</span></p>
                <p>RSI = 25 (과매도) &nbsp;<span className="text-up">+0.5</span></p>
                <p className="pt-1 border-t border-border-subtle font-bold text-white">= +2.0 → 강한 매수</p>
              </div>
            </div>
            <div className={INNER_CLS}>
              <p className="text-xs font-bold text-down mb-2">예시: 강한 매도 (-2.0)</p>
              <div className="font-mono text-xs text-gray-300 space-y-1">
                <p>현재가 40,000 &lt; MA20 45,000 &nbsp;<span className="text-down">-1.0</span></p>
                <p>MA20 45,000 &lt; MA60 50,000 &nbsp;<span className="text-down">-0.5</span></p>
                <p>RSI = 75 (과매수) &nbsp;<span className="text-down">-0.5</span></p>
                <p className="pt-1 border-t border-border-subtle font-bold text-white">= -2.0 → 강한 매도</p>
              </div>
            </div>
          </div>

          <div className="mt-4 bg-info-soft border border-info/30 rounded-lg px-4 py-3 flex items-start gap-2">
            <Info className="h-4 w-4 text-info shrink-0 mt-px" aria-hidden="true" />
            <p className="text-xs text-gray-200">
              <span className="font-bold text-info">참고:</span> 암호화폐(코인)는 서버에서 MA를 계산하지 않아 항상 "중립"으로 표시됩니다. 스마트 필터에서는 프론트엔드가 별도 계산하므로 MA/RSI 필터를 사용할 수 있습니다.
            </p>
          </div>
        </section>

        {/* ━━━━━━━━━━ 2. 이동평균선 ━━━━━━━━━━ */}
        <section
          id="ma"
          ref={el => { sectionRefs.current['ma'] = el; }}
          className={SECTION_CLS}
        >
          <GuideSectionHeader id="ma" title="이동평균선 (MA) 해석법" />

          <p className="text-sm text-gray-300 mb-4">
            이동평균선은 일정 기간의 <span className="text-gray-100 font-semibold">종가 평균</span>을 이은 선입니다.
            주가가 이 선 위에 있으면 상승 추세, 아래면 하락 추세로 판단합니다.
          </p>

          <div className="grid sm:grid-cols-2 gap-3 mb-5">
            <div className={INNER_CLS}>
              <div className="flex items-center gap-2 mb-2">
                {/* 선 견본 = 차트 기본 식별 색(utils/maCalculations) */}
                <div className="w-8 h-1 rounded" style={{ backgroundColor: getDefaultMAColor(20) }} />
                <h4 className="text-sm font-bold text-white">MA20 (20일선)</h4>
              </div>
              <p className="text-xs text-gray-400">단기 추세를 나타냅니다. "최근 한 달간의 평균 가격"으로, 빠르게 반응합니다.</p>
            </div>
            <div className={INNER_CLS}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-1 rounded" style={{ backgroundColor: getDefaultMAColor(60) }} />
                <h4 className="text-sm font-bold text-white">MA60 (60일선)</h4>
              </div>
              <p className="text-xs text-gray-400">중기 추세를 나타냅니다. "최근 3개월간의 평균 가격"으로, 큰 흐름을 보여줍니다.</p>
            </div>
          </div>

          <h4 className="text-sm font-bold text-white mb-3">핵심 패턴</h4>
          <div className="space-y-3">
            <div className={ROW_CLS}>
              <TrendingUp className="h-5 w-5 text-up shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-up">정배열 (MA20 &gt; MA60)</p>
                <p className="text-xs text-gray-400 mt-0.5">단기 평균이 장기 평균보다 높은 상태 → 상승 추세가 확립된 것. 보유 유지 또는 매수 고려.</p>
              </div>
            </div>
            <div className={ROW_CLS}>
              <TrendingDown className="h-5 w-5 text-down shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-down">역배열 (MA20 &lt; MA60)</p>
                <p className="text-xs text-gray-400 mt-0.5">단기 평균이 장기 평균보다 낮은 상태 → 하락 추세. 매도 고려 또는 매수 보류.</p>
              </div>
            </div>
            <div className={ROW_CLS}>
              <Star className="h-5 w-5 text-up shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-up">골든크로스 (정배열 상태: MA20 &gt; MA60)</p>
                <p className="text-xs text-gray-400 mt-0.5">MA20이 MA60을 아래에서 위로 돌파해 정배열이 된 상태. <span className="text-white font-medium">강력한 매수 신호</span> — 앱은 현재 정배열 여부로 판정하고, 교차 시점은 경과일 뱃지로 표시해요.</p>
              </div>
            </div>
            <div className={ROW_CLS}>
              <Star className="h-5 w-5 text-down shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-down">데드크로스 (역배열 상태: MA20 &lt; MA60)</p>
                <p className="text-xs text-gray-400 mt-0.5">MA20이 MA60을 위에서 아래로 돌파해 역배열이 된 상태. <span className="text-white font-medium">강력한 매도 신호</span> — 앱은 현재 역배열 여부로 판정하고, 교차 시점은 경과일 뱃지로 표시해요.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ━━━━━━━━━━ 3. RSI ━━━━━━━━━━ */}
        <section
          id="rsi"
          ref={el => { sectionRefs.current['rsi'] = el; }}
          className={SECTION_CLS}
        >
          <GuideSectionHeader id="rsi" title="RSI (상대강도지수) 해석법" />

          <p className="text-sm text-gray-300 mb-4">
            RSI는 최근 14일간 상승과 하락의 <span className="text-gray-100 font-semibold">상대적 강도</span>를 0~100으로 나타낸 지표입니다.
            "얼마나 많이 올랐는가/떨어졌는가"를 수치로 보여줍니다.
          </p>

          {/* RSI 게이지 — 양 끝(과매도·과매수)은 둘 다 "확인이 필요한 구간"이라 warning, 가운데는 중립 */}
          <div className={`mb-5 ${INNER_CLS}`}>
            <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
              <span>0</span>
              <span className="flex-1" />
              <span>30</span>
              <span className="flex-1" />
              <span>70</span>
              <span className="flex-1" />
              <span>100</span>
            </div>
            <div className="flex h-6 rounded-lg overflow-hidden">
              <div className="bg-warning-soft flex-[30] flex items-center justify-center">
                <span className="text-xs text-warning font-bold">과매도</span>
              </div>
              <div className="bg-surface-elevated flex-[40] flex items-center justify-center">
                <span className="text-xs text-gray-300 font-bold">정상 구간</span>
              </div>
              <div className="bg-warning-soft flex-[30] flex items-center justify-center">
                <span className="text-xs text-warning font-bold">과매수</span>
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 mb-5">
            <div className={INNER_CLS}>
              <p className="text-sm font-bold text-warning mb-1 flex items-center gap-1"><TriangleAlert className="h-4 w-4" aria-hidden="true" />RSI &le; 30 (과매도)</p>
              <p className="text-xs text-gray-400">"너무 많이 떨어졌다"는 신호. 단, RSI는 <span className="text-gray-300">보조 지표</span> — 하락 추세 종목은 과매도만 보고 사지 말고 추세(이평선)와 함께 판단.</p>
            </div>
            <div className={INNER_CLS}>
              <p className="text-sm font-bold text-gray-300 mb-1">30 &lt; RSI &lt; 70 (정상)</p>
              <p className="text-xs text-gray-400">정상 범위. 추세 방향은 이동평균선과 함께 판단합니다.</p>
            </div>
            <div className={INNER_CLS}>
              <p className="text-sm font-bold text-warning mb-1 flex items-center gap-1"><TriangleAlert className="h-4 w-4" aria-hidden="true" />RSI &ge; 70 (과매수)</p>
              <p className="text-xs text-gray-400">"너무 많이 올랐다"는 신호. 단, RSI는 <span className="text-gray-300">보조 지표</span> — 상승 추세면 계속 높을 수 있으니 추세(이평선)와 함께 판단.</p>
            </div>
          </div>

          <h4 className="text-sm font-bold text-white mb-3">전환 시그널 (스마트 필터)</h4>
          <div className="space-y-2">
            <div className={ROW_CLS}>
              <ArrowUp className="h-4 w-4 text-up shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-up">RSI 반등 (어제 &le;30 → 오늘 &gt;30)</p>
                <p className="text-xs text-gray-400 mt-0.5">과매도 영역을 탈출하기 시작. 바닥을 찍고 반등하는 신호 → 매수 타이밍 탐색.</p>
              </div>
            </div>
            <div className={ROW_CLS}>
              <ArrowDown className="h-4 w-4 text-down shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-down">RSI 과열진입 (어제 &lt;70 → 오늘 &ge;70)</p>
                <p className="text-xs text-gray-400 mt-0.5">과매수 영역에 진입. 과열 시작 신호 → 매도 타이밍 탐색.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ━━━━━━━━━━ 4. 스마트 필터 ━━━━━━━━━━ */}
        <section
          id="filter"
          ref={el => { sectionRefs.current['filter'] = el; }}
          className={SECTION_CLS}
        >
          <GuideSectionHeader id="filter" title="스마트 필터 사용법" />

          <div className={`${INNER_CLS} mb-5`}>
            <p className="text-sm font-bold text-white mb-2">필터 조합 규칙</p>
            <div className="text-xs text-gray-300 space-y-1.5">
              <p><span className="text-gray-100 font-semibold">같은 그룹 내:</span> OR 논리 — 하나라도 해당되면 표시</p>
              <p><span className="text-gray-100 font-semibold">다른 그룹 간:</span> AND 논리 — 모든 그룹 조건 충족 시 표시</p>
              <p className="text-gray-400 mt-2">예: <span className={CHIP_CLS}>골든크로스</span> + <span className={CHIP_CLS}>RSI 반등</span> → MA그룹 AND RSI그룹 교집합</p>
            </div>
          </div>

          {/* 4개 그룹 — 그룹 구분 점은 CATEGORY_PALETTE(상태 색 아님) */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* MA 그룹 */}
            <div className={INNER_CLS}>
              <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_PALETTE[0] }} />
                이동평균 (MA) 그룹
              </h4>
              <div className="space-y-2 text-xs text-gray-300">
                <div><span className="font-semibold text-white">현재가 &gt; 단기MA</span> — 가격이 단기 이동평균 위 (단기 상승)</div>
                <div><span className="font-semibold text-white">현재가 &gt; 장기MA</span> — 가격이 장기 이동평균 위 (장기 상승)</div>
                <div><span className="font-semibold text-white">정배열</span> — 단기MA &gt; 장기MA (상승 추세)</div>
                <div><span className="font-semibold text-white">역배열</span> — 단기MA &lt; 장기MA (하락 추세)</div>
                <div><span className="font-semibold text-white">골든크로스</span> — 단기MA가 장기MA 위로 올라선 상태 (교차 시점은 경과일 뱃지로 표시)</div>
                <div><span className="font-semibold text-white">데드크로스</span> — 단기MA가 장기MA 아래로 내려간 상태 (교차 시점은 경과일 뱃지로 표시)</div>
                <p className="text-gray-500 mt-1">* 드롭다운에서 단기(10/20/60), 장기(60/120/200) 기간 선택 가능</p>
              </div>
            </div>

            {/* RSI 그룹 */}
            <div className={INNER_CLS}>
              <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_PALETTE[2] }} />
                RSI 그룹
              </h4>
              <div className="space-y-2 text-xs text-gray-300">
                <div><span className="font-semibold text-white">과매수 (RSI &ge; 70)</span> — 과열 구간 (보조 지표 — 추세와 함께 판단)</div>
                <div><span className="font-semibold text-white">과매도 (RSI &le; 30)</span> — 침체 구간 (보조 지표 — 추세와 함께 판단)</div>
                <div><span className="font-semibold text-white">RSI 반등</span> — 과매도 탈출 (어제 &le;30 → 오늘 &gt;30)</div>
                <div><span className="font-semibold text-white">RSI 과열진입</span> — 과매수 진입 (어제 &lt;70 → 오늘 &ge;70)</div>
              </div>
            </div>

            {/* 매매신호 그룹 */}
            <div className={INNER_CLS}>
              <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_PALETTE[1] }} />
                매매신호 그룹
              </h4>
              <div className="space-y-2 text-xs text-gray-300">
                <div><span className={`px-1.5 py-0.5 rounded text-xs font-bold ${SIGNAL_BADGE.strongBuy}`}>강한 매수</span> — 서버 분석 점수 +1.5 이상</div>
                <div><span className={`px-1.5 py-0.5 rounded text-xs font-bold ${SIGNAL_BADGE.buy}`}>매수</span> — 서버 분석 점수 +0.5 이상</div>
                <div><span className={`px-1.5 py-0.5 rounded text-xs font-bold ${SIGNAL_BADGE.sell}`}>매도</span> — 서버 분석 점수 -0.5 이하</div>
                <div><span className={`px-1.5 py-0.5 rounded text-xs font-bold ${SIGNAL_BADGE.strongSell}`}>강한 매도</span> — 서버 분석 점수 -1.5 이하</div>
              </div>
            </div>

            {/* 포트폴리오 그룹 */}
            <div className={INNER_CLS}>
              <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_PALETTE[3] }} />
                포트폴리오 그룹
              </h4>
              <div className="space-y-2 text-xs text-gray-300">
                <div><span className="font-semibold text-white">수익중</span> — 현재 수익률 &gt; 0%</div>
                <div><span className="font-semibold text-white">손실중</span> — 현재 수익률 &lt; 0%</div>
                <div><span className="font-semibold text-white">고점대비 하락</span> — 52주 최고가 대비 설정 비율(%) 이상 하락</div>
                <div className="pt-1.5 border-t border-border-subtle">
                  <span className="font-semibold text-warning inline-flex items-center gap-1"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />매도 알림</span> — 52주 최고가 대비 설정 비율 이상 하락 시 경고 배지 표시 (종목별/전체 설정 가능)
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ━━━━━━━━━━ 5. 실전 활용법 ━━━━━━━━━━ */}
        <section
          id="strategy"
          ref={el => { sectionRefs.current['strategy'] = el; }}
          className={SECTION_CLS}
        >
          <GuideSectionHeader id="strategy" title="실전 활용법 — 필터 조합 시나리오" />

          {/* 매수 시나리오 */}
          <div className="mb-6">
            <h4 className="text-sm font-bold text-up mb-3 flex items-center gap-2">
              <ArrowUp className="w-4 h-4" aria-hidden="true" />
              매수 타이밍 찾기
            </h4>
            <div className="space-y-3">
              <div className={INNER_CLS}>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={CHIP_CLS}>골든크로스</span>
                  <span className="text-gray-500 text-xs">+</span>
                  <span className={CHIP_CLS}>RSI 반등↑</span>
                </div>
                <p className="text-xs text-gray-300">하락→상승 추세 전환 + 과매도 탈출 = <span className="text-up font-semibold">가장 강력한 매수 신호</span></p>
              </div>
              <div className={INNER_CLS}>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={CHIP_CLS}>정배열</span>
                  <span className="text-gray-500 text-xs">+</span>
                  <span className={CHIP_CLS}>과매도</span>
                </div>
                <p className="text-xs text-gray-300">상승 추세 유지 중 일시적 조정 = <span className="text-up font-semibold">눌림목 매수 기회</span></p>
              </div>
              <div className="bg-warning-soft border border-warning/30 rounded-lg p-4">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SIGNAL_BADGE.strongBuy}`}>강한 매수</span>
                  <span className="text-gray-500 text-xs">+</span>
                  <span className={CHIP_CLS}>손실중</span>
                </div>
                <p className="text-xs text-gray-300 flex items-start gap-1.5">
                  <TriangleAlert className="h-4 w-4 text-warning shrink-0" aria-hidden="true" />
                  <span>기술적으로 매수 신호여도 매입가보다 낮은 상태에서의 추가매수는 '물타기'예요. <span className="text-warning font-semibold">손실 종목 물타기는 피하고, 먼저 손절·무효화 기준을 확인하세요.</span></span>
                </p>
              </div>
            </div>
          </div>

          {/* 매도 시나리오 */}
          <div className="mb-6">
            <h4 className="text-sm font-bold text-down mb-3 flex items-center gap-2">
              <ArrowDown className="w-4 h-4" aria-hidden="true" />
              매도 타이밍 찾기
            </h4>
            <div className="space-y-3">
              <div className={INNER_CLS}>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={CHIP_CLS}>데드크로스</span>
                  <span className="text-gray-500 text-xs">+</span>
                  <span className={CHIP_CLS}>RSI 과열진입↓</span>
                </div>
                <p className="text-xs text-gray-300">상승→하락 추세 전환 + 과매수 진입 = <span className="text-down font-semibold">가장 강력한 매도 신호</span></p>
              </div>
              <div className={INNER_CLS}>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={CHIP_CLS}>과매수</span>
                  <span className="text-gray-500 text-xs">+</span>
                  <span className={CHIP_CLS}>수익중</span>
                </div>
                <p className="text-xs text-gray-300">과열 상태 + 이미 수익 중 = <span className="text-down font-semibold">수익 실현 타이밍</span></p>
              </div>
              <div className={INNER_CLS}>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={CHIP_CLS}>역배열</span>
                  <span className="text-gray-500 text-xs">+</span>
                  <span className={CHIP_CLS}>고점대비 하락</span>
                </div>
                <p className="text-xs text-gray-300">하락 추세 + 고점 대비 큰 폭 하락 = <span className="text-down font-semibold">손절 검토</span></p>
              </div>
            </div>
          </div>

          {/* 관망 시나리오 */}
          <div>
            <h4 className="text-sm font-bold text-gray-400 mb-3 flex items-center gap-2">
              <Eye className="w-4 h-4" aria-hidden="true" />
              관망 (매수 금지)
            </h4>
            <div className={INNER_CLS}>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={CHIP_CLS}>역배열</span>
                <span className="text-gray-500 text-xs">+</span>
                <span className={CHIP_CLS}>과매도</span>
              </div>
              <p className="text-xs text-gray-300">하락 추세 + 계속 하락 중 = <span className="text-gray-300 font-semibold">"떨어지는 칼날을 잡지 마라"</span> — 추세 전환(골든크로스/RSI반등) 확인 후 매수</p>
            </div>
          </div>
        </section>

        {/* ━━━━━━━━━━ 6. 투자 원칙 ━━━━━━━━━━ */}
        <section
          id="tips"
          ref={el => { sectionRefs.current['tips'] = el; }}
          className={SECTION_CLS}
        >
          <GuideSectionHeader id="tips" title="투자 원칙 & 주의사항" />

          <div className="space-y-3">
            {[
              { t: '시그널은 확률이지, 확정이 아닙니다', d: '"강한 매수"가 떠도 100% 오른다는 보장은 없습니다. 여러 지표가 같은 방향을 가리킬 때 신뢰도가 높아집니다.' },
              { t: '분할 매수/매도를 습관화하세요', d: '한 번에 전량 매수/매도하지 말고 3~4회로 나눠서 진입/청산하세요. 타이밍을 완벽하게 맞추는 것은 불가능합니다.' },
              { t: '큰 추세(배열)를 먼저 확인하세요', d: '정배열이면 매수 위주, 역배열이면 관망/매도 위주로 전략을 잡으세요. 역배열에서의 매수는 고위험입니다.' },
              { t: '매도 알림(손절)을 반드시 설정하세요', d: '고점 대비 하락률을 설정해두면 큰 손실을 방지할 수 있습니다. 기본값은 20%이며, 종목 특성에 따라 조정하세요.' },
              { t: '단일 지표보다 조합을 신뢰하세요', d: 'RSI만 보거나 MA만 보지 말고, 스마트 필터에서 여러 그룹의 필터를 조합하세요. 교차 확인(Cross-confirmation)이 핵심입니다.' },
            ].map((tip, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-7 h-7 rounded-lg bg-surface-muted border border-border-subtle flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-gray-200 text-sm font-bold">{i + 1}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{tip.t}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{tip.d}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 bg-surface-muted border border-border-subtle rounded-lg px-4 py-3">
            <p className="text-xs text-gray-400">
              <span className="text-gray-200 font-semibold">면책 조항:</span> 이 앱은 <span className="text-white">투자자문이 아닙니다</span>. 클라이맥스 탑·디스트리뷰션·리스크 매트릭스를 포함한 모든 시그널과 지표는 <span className="text-white">예측이 아닌 과열 리스크에 대한 참고용 경고</span>이며, 투자 결정의 최종 책임은 사용자 본인에게 있습니다.
              기업의 실적, 뉴스, 시장 상황 등 기술적 분석 외의 요인도 반드시 함께 고려하세요.
            </p>
          </div>
        </section>

      </div>
    </div>
  );
};

export default InvestmentGuideView;
