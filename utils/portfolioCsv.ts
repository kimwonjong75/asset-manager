import type { Asset, ExchangeRates } from '../types';
import type { PLBasis } from '../types/valuation';
import { getCategoryName, DEFAULT_CATEGORIES } from '../types/category';
import { getAssetOwner, getOwnerLabel, hasUnresolvedOwners, OWNER_LABELS } from '../types/owner';
import { computeAssetMetrics } from './portfolioMetrics';

export function csvExportScope(assets: readonly Asset[]): string {
  const counts = { WONJONG: 0, YUSEON: 0 };
  let unresolved = 0;
  for (const asset of assets) {
    if (hasUnresolvedOwners(asset)) unresolved++;
    else counts[getAssetOwner(asset)]++;
  }
  const pending = unresolved ? ` · 분할 확인 필요 ${unresolved}건` : '';
  return `전체 계정 · ${OWNER_LABELS.WONJONG} ${counts.WONJONG}건 · ${OWNER_LABELS.YUSEON} ${counts.YUSEON}건${pending}`;
}

function escapeCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function buildPortfolioCsv(assets: readonly Asset[], exchangeRates: ExchangeRates, plBasis: PLBasis): string {
  const header = [
    '종목명', '티커', '거래소', '자산구분', '보유수량',
    '매수단가(자국통화)', '매수환율', '총매수금액(원화)',
    '현재단가(원화)', '현재평가금액(원화)', '총손익(원화)', '수익률(%)', '소유 계정', '시세 기준일'
  ];
  const rows = assets.map(asset => {
    // 계산은 화면 표와 동일한 단일 모듈 (기존 열 순서는 그대로 — docs/backtest/PROMPT_1_데이터정리.md가 참조).
    // '매수환율'은 원본 데이터라 수익률 기준과 무관하게 계속 내보낸다(원화 기준 재계산·세무 참고용).
    const { metrics } = computeAssetMetrics(asset, exchangeRates, 0, { plBasis });
    return [
      (asset.customName?.trim() || asset.name),
      asset.ticker,
      asset.exchange,
      getCategoryName(asset.categoryId, DEFAULT_CATEGORIES),
      asset.quantity,
      asset.purchasePrice,
      asset.purchaseExchangeRate ?? '',
      Math.round(metrics.purchaseValueKRW),
      Math.round(metrics.currentPriceKRW),
      Math.round(metrics.currentValueKRW),
      Math.round(metrics.profitLossKRW),
      metrics.returnPercentage.toFixed(2),
      hasUnresolvedOwners(asset) ? '분할 확인 필요' : getOwnerLabel(asset.owner),
      asset.quoteDate || '미확인',
    ].map(escapeCell).join(',');
  });
  return [header.join(','), ...rows].join('\n');
}
