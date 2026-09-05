import { useEffect } from 'react';
import { Asset, Currency, ExchangeRates, PortfolioSnapshot } from '../types';
import { computeAssetMetrics } from '../utils/portfolioMetrics';

interface UsePortfolioHistoryProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
  setPortfolioHistory: React.Dispatch<React.SetStateAction<PortfolioSnapshot[]>>;
}

/**
 * 일별 포트폴리오 스냅샷 기록 (최근 365일).
 *
 * ## 기록 규약 — `purchaseValue`는 **항상 원화 기준('krw')**
 * 수익률 기준 설정(`plBasis`)과 무관하게 매수 당시 환율로 계산한 값을 저장한다. 이유:
 *   · `utils/historyUtils.repairCorruptedSnapshots`의 손상 판정이 `|currentValue/purchaseValue| >= 10`이라
 *     기준이 섞이면 정상 데이터를 손상으로 오판할 수 있다.
 *   · 이미 저장된 스냅샷 전부가 원화 기준이라 의미가 어긋난다.
 * 달러 기준 표시는 저장이 아니라 **표시 시점 파생**으로 처리한다 —
 * `purchaseUnitOriginal`(원통화 평균 매수단가, 외화 자산만)을 함께 기록해 두고
 * `utils/portfolioMetrics.deriveSnapshotPurchaseValue`가 그날 환율을 약분해 복원한다.
 *
 * ## 계산 단일화 (의도된 미세 차이)
 * 이전에는 이 파일이 `getPurchaseValueInKRW` 사본을 들고 `exchangeRates[cur] || 0`으로 환산했다.
 * 지금은 `computeAssetMetrics`가 쓰는 `resolveRate`(현재 → 마지막 정상 캐시 → 0)를 타므로
 * **환율 일시 미수신 상태에서도 0원 스냅샷이 덜 생긴다**(= 손상 스냅샷 감소). 값이 커지는 방향의 변화는 없다.
 * 또 하나: 업비트/빗썸 자산은 통화가 KRW가 아니어도 시세가 원화라 환율을 곱하지 않는다
 * (표·대시보드와 동일 규약. 실사용에선 시세 갱신 때 currency가 KRW로 고정되므로 대부분 무영향).
 */
export const usePortfolioHistory = ({ assets, exchangeRates, setPortfolioHistory }: UsePortfolioHistoryProps) => {
  useEffect(() => {
    const updatePortfolioHistory = () => {
      if (assets.length === 0) return;
      const today = new Date().toISOString().slice(0, 10);
      const newAssetSnapshots = assets.map(asset => {
        // 스냅샷은 항상 원화 기준으로 기록 (위 주석 참고)
        const { metrics } = computeAssetMetrics(asset, exchangeRates, 0, { plBasis: 'krw' });

        // 외화 원본 단가 — priceOriginal이 있으면 사용, 없으면 currentPrice
        const unitPriceOriginal = asset.priceOriginal > 0 ? asset.priceOriginal : asset.currentPrice;

        return {
          id: asset.id,
          name: (asset.customName?.trim() || asset.name),
          currentValue: metrics.currentValueKRW,
          purchaseValue: metrics.purchaseValueKRW,
          unitPrice: metrics.currentPriceKRW,   // currentValue / unitPrice = 수량 (복구 로직이 역산에 쓴다)
          unitPriceOriginal,
          currency: asset.currency,
          // 달러 기준 파생용 — 외화 자산에만 기록(KRW 자산은 purchaseValue로 충분)
          ...(asset.currency !== Currency.KRW ? { purchaseUnitOriginal: asset.purchasePrice } : {}),
        };
      });
      const newSnapshot = { date: today, assets: newAssetSnapshots };
      setPortfolioHistory(prevHistory => {
        const todayIndex = prevHistory.findIndex(snap => snap.date === today);
        let updatedHistory;
        if (todayIndex > -1) {
          updatedHistory = [...prevHistory];
          updatedHistory[todayIndex] = newSnapshot;
        } else {
          updatedHistory = [...prevHistory, newSnapshot];
        }
        if (updatedHistory.length > 365) {
          updatedHistory = updatedHistory.slice(updatedHistory.length - 365);
        }
        return updatedHistory;
      });
    };
    updatePortfolioHistory();
  }, [assets, exchangeRates, setPortfolioHistory]);
};
