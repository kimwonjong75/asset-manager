// components/settings/KakaoSetupWizard.tsx
// 카카오톡 알림 1회 설정 — 5단계 체크리스트(계획서 §6.4·§4.6 "카톡 설정" row). 렌더 전용.
// 완료 표시는 단순 UI 플래그라 localStorage에 직접 try/catch로 저장한다
// (components/trade-plan/TradePlanIntro.tsx와 동일 관례 — PortfolioContext의 다른 UI 플래그들과 같은 층).
// 실제 배포·인증 행위(clasp push, Kakao 동의)는 전부 사용자가 브라우저 밖에서 직접 한다 — 이 위저드는
// 안내와 진행 표시만 한다.

import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';

const WIZARD_PROGRESS_KEY = 'asset-manager-kakao-wizard-progress-v1';

function loadProgress(): boolean[] {
  try {
    const raw = localStorage.getItem(WIZARD_PROGRESS_KEY);
    if (!raw) return [false, false, false, false, false];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 5) return parsed.map(Boolean);
  } catch {
    /* ignore */
  }
  return [false, false, false, false, false];
}

function saveProgress(steps: boolean[]): void {
  try {
    localStorage.setItem(WIZARD_PROGRESS_KEY, JSON.stringify(steps));
  } catch {
    /* ignore */
  }
}

interface WizardStep {
  title: string;
  body: React.ReactNode;
  hint: string;
}

const STEPS: WizardStep[] = [
  {
    title: '① 카카오 개발자 앱 만들기',
    body: (
      <>
        <a href="https://developers.kakao.com" target="_blank" rel="noopener noreferrer" className="text-primary-light hover:underline">
          Kakao Developers<ExternalLink className="inline h-3 w-3 ml-0.5 align-[-1px]" aria-hidden="true" />
        </a>
        {' '}에서 애플리케이션을 추가하고, <b>카카오 로그인</b>을 켠 뒤 동의항목에서{' '}
        <code className="bg-gray-800 px-1 rounded text-xs">talk_message</code>(카카오톡 메시지 전송)를 설정하세요.
        Redirect URI는 3단계에서 얻는 웹앱 URL을 나중에 등록해도 됩니다 — 등록 위치는{' '}
        <b>[앱] → [플랫폼 키] → REST API 키</b> 화면 안의 <b>[카카오 로그인 리다이렉트 URI]</b> 입력란입니다.
      </>
    ),
    hint: '막히면 여기: "카카오 로그인" 메뉴가 안 보이면 앱 요약 정보에서 플랫폼(Web) 등록이 먼저 필요합니다. 동의 화면 이후 "앱 관리자 설정 오류(KOE006)"가 뜨면 리다이렉트 URI 미등록/불일치이니 REST API 키 화면에서 확인하세요.',
  },
  {
    title: '② 스크립트 배포 (Google Apps Script)',
    body: (
      <>
        터미널에서 저장소 루트로 이동해 <code className="bg-gray-800 px-1 rounded text-xs">npm install</code>을
        한 번 실행한 뒤(<code className="bg-gray-800 px-1 rounded text-xs">@google/clasp</code>가 설치됩니다){' '}
        <code className="bg-gray-800 px-1 rounded text-xs">npx clasp login</code> 으로 로그인한 뒤{' '}
        <code className="bg-gray-800 px-1 rounded text-xs">npm run gas:push</code> 로 스크립트를 올리고,
        Apps Script 편집기에서 <b>배포 → 웹앱</b>으로 배포하세요(실행: 나, 액세스: 모든 사용자).
        배포 후 나오는 <code className="bg-gray-800 px-1 rounded text-xs">/exec</code> URL을 복사해 두세요.
      </>
    ),
    hint: '막히면 여기: "could not determine executable to run" 오류가 뜨면 npm install을 먼저 실행하세요(@google/clasp 미설치). 재배포할 때마다 URL이 바뀔 수도 있습니다(새 버전 배포 시) — 바뀌면 아래 웹앱 URL을 다시 입력하고 1단계 Redirect URI도 갱신하세요.',
  },
  {
    title: '③ 열쇠 입력 + 트리거 설치',
    body: (
      <>
        Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성에{' '}
        <code className="bg-gray-800 px-1 rounded text-xs">KAKAO_REST_KEY</code>(1단계 앱의 REST API 키)와{' '}
        <code className="bg-gray-800 px-1 rounded text-xs">SHARED_SECRET</code>(임의의 긴 문자열, 앱 설정에도 동일하게 입력)를 추가하세요.
        1단계의 <b>[앱] → [플랫폼 키] → REST API 키 → [클라이언트 시크릿]</b>이 활성화돼 있다면 그 코드값도{' '}
        <code className="bg-gray-800 px-1 rounded text-xs">KAKAO_CLIENT_SECRET</code>으로 추가하세요.
        그 다음 함수 목록에서 <code className="bg-gray-800 px-1 rounded text-xs">installTriggers</code>를 한 번 실행하세요.
      </>
    ),
    hint: '막히면 여기: 처음 실행 시 권한 승인 화면이 뜹니다. 본인 계정이므로 "고급 → 이동(안전하지 않음)"을 눌러 진행해도 안전합니다. ④에서 "invalid_client(KOE010)"가 뜨면 KAKAO_CLIENT_SECRET을 빠뜨린 것입니다.',
  },
  {
    title: '④ 카카오 1회 동의',
    body: (
      <>
        브라우저에서 <code className="bg-gray-800 px-1 rounded text-xs">&lt;웹앱 URL&gt;?action=kakao-auth</code> 를 열어
        카카오 로그인/동의를 1회 진행하세요. "연결됨"이 뜨면 완료입니다. 이후로는 브라우저 개입이 필요 없습니다(리프레시 토큰이 자동 갱신됩니다).
      </>
    ),
    hint: '막히면 여기: "등록되지 않은 Redirect URI" 오류가 뜨면 1단계 Kakao Developers의 Redirect URI에 이 웹앱 URL을 정확히 등록했는지 확인하세요.',
  },
  {
    title: '⑤ 앱에 연결',
    body: (
      <>
        아래 <b>웹앱 URL</b>과 <b>공유 시크릿</b>(③에서 정한 값)을 입력하고 [연결 테스트]를 눌러보세요.
        카카오톡 "나에게 보내기"로 테스트 메시지가 오면 성공입니다. 이어서 [지금 동기화]를 누르면 현재 활성 계획이 전달됩니다.
      </>
    ),
    hint: '막히면 여기: 연결 테스트가 실패하면 URL 끝의 /exec 포함 여부, 시크릿 오타, ③의 스크립트 속성 저장 여부를 확인하세요.',
  },
];

const KakaoSetupWizard: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [steps, setSteps] = useState<boolean[]>(() => loadProgress());
  const doneCount = steps.filter(Boolean).length;

  const toggleStep = (i: number) => {
    setSteps(prev => {
      const next = [...prev];
      next[i] = !next[i];
      saveProgress(next);
      return next;
    });
  };

  return (
    <div className={`bg-gray-900/50 border border-gray-700 rounded-lg p-3.5 space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">1회 설정 가이드</h3>
        <span className="text-xs text-gray-400">{doneCount}/5 완료</span>
      </div>
      <p className="text-xs text-gray-500">
        모든 단계는 되돌릴 수 있습니다 — 잘못 눌렀거나 재배포했다면 해당 단계만 다시 하면 됩니다.
        상세 설명은{' '}
        <span className="text-gray-400">docs/카카오톡_알림_설정가이드.md</span> 문서를 참고하세요.
      </p>
      <ol className="space-y-2.5">
        {STEPS.map((step, i) => (
          <li key={i} className="border-t border-gray-800 pt-2.5 first:border-t-0 first:pt-0">
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={steps[i]}
                onChange={() => toggleStep(i)}
                className="mt-0.5 cursor-pointer flex-shrink-0"
              />
              <div className="min-w-0">
                <div className={`text-xs font-semibold ${steps[i] ? 'text-ok line-through decoration-ok/60' : 'text-gray-200'}`}>
                  {step.title}
                </div>
                <p className="text-xs text-gray-400 leading-relaxed mt-0.5">{step.body}</p>
                <p className="text-xs text-amber-500/80 mt-1">{step.hint}</p>
              </div>
            </label>
          </li>
        ))}
      </ol>
    </div>
  );
};

export default KakaoSetupWizard;
