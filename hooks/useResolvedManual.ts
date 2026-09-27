// hooks/useResolvedManual.ts
// ---------------------------------------------------------------------------
// "터틀 사용설명서"(docs/터틀_사용설명서.md)를 지금 사용자의 터틀 설정으로 치환한 결과를 돌려주는
// 공용 훅(2026-09-27) — ManualView('사용설명서' 탭)와 ManualDrawer("? 설명" 사이드 패널)가 둘 다
// 같은 계산(resolveHoldingsSettings → renderManualTemplate)을 반복하지 않도록 여기로 뺐다.
// API 호출 없음(순수 계산 + 번들 포함 md), PortfolioContext만 읽는다.

import { useMemo } from 'react';
import manualMd from '../docs/터틀_사용설명서.md?raw';
import { usePortfolio } from '../contexts/PortfolioContext';
import { resolveHoldingsSettings } from '../utils/turtleHoldings';
import { renderManualTemplate } from '../utils/manualTemplate';

/** 설정값이 {{키}} 자리에 치환된 사용설명서 원문. 미해석 키가 있어도 원문 {{키}}가 그대로 보일 뿐
 *  throw하지 않는다(renderManualTemplate 계약). */
export function useResolvedManual(): string {
  const { data } = usePortfolio();
  const settings = resolveHoldingsSettings(data.turtleSettings.holdings);
  return useMemo(() => renderManualTemplate(manualMd, settings).text, [settings]);
}
