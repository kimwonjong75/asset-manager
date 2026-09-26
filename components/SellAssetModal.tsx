// components/SellAssetModal.tsx
// 수정된 버전: 매도 통화를 자산 통화로 고정

import React, { useState, useEffect, useRef, useId } from 'react';
import { Asset, Currency, CURRENCY_SYMBOLS, SellTransaction } from '../types';
import { isBaseType } from '../types/category';
import { formatQuantity } from './portfolio-table/utils';
import { usePortfolio } from '../contexts/PortfolioContext';
import { defaultSellOutcome, sellPrefillFor } from '../utils/tradePlanLink';
import type { SellOutcome } from '../types/tradePlan';
import { resolveHoldingsSettings, isInHoldingsScope } from '../utils/turtleHoldings';
import Segmented from './common/Segmented';
import Modal from './common/Modal';
import Button from './common/Button';
import FieldError from './common/FieldError';

/** 매도 효과 선택지 (P2b) — 라벨과 아래 설명이 1:1로 대응한다. */
const SELL_OUTCOME_OPTIONS: { value: SellOutcome; label: string; hint: string }[] = [
  { value: 'half', label: '익절 절반', hint: '익절 절반: 계획 수량의 절반만 팔고 익절선은 완료 처리됩니다' },
  { value: 'stop', label: '손절 전량', hint: '손절 전량: 보유 수량 전부를 팔고 계획을 종료합니다' },
  { value: 'exit', label: '추세이탈 전량', hint: '추세이탈 전량: 나머지 전량을 팔고 계획을 종료합니다' },
  { value: 'none', label: '계획과 무관', hint: '계획과 무관: 매도 기록만 남기고 계획 상태는 바꾸지 않습니다' },
];

const SellAssetModal: React.FC = () => {
  const { data, modal, actions, status, derived } = usePortfolio();
  const asset = modal.sellingAsset;
  const isOpen = !!modal.sellingAsset;
  const onClose = actions.closeSellModal;
  const isLoading = status.isLoading;
  const [sellDate, setSellDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [sellPrice, setSellPrice] = useState<string>('');
  const [sellQuantity, setSellQuantity] = useState<string>('');
  const [sellOutcome, setSellOutcome] = useState<SellOutcome>('none');
  // "보유종목 터틀" 감시 명단 추가(계획서 §4.2) — 범위 내 자산만 체크박스 노출, 기본 켬(사용자 동작 동반).
  const holdingsSettings = resolveHoldingsSettings(data.turtleSettings.holdings);
  const inHoldingsScope = !!asset && isInHoldingsScope(asset, holdingsSettings);
  const [addToTurtleWatch, setAddToTurtleWatch] = useState(true);
  // 제출 시도 후에만 인라인 검증 문구 노출(브라우저 alert 대체 — RULES.md §7)
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // 폼 오류 문구 id — 조기 return 앞에서 호출(훅 순서 고정). 오류 필드의 aria-describedby 대상.
  const formErrorId = useId();

  // 최신 평가 행은 ref로 미러링한다(usePriceFreshnessRefresh와 동일 접근) —
  // derived.tradePlanRows는 배경 시세 갱신마다 참조가 바뀌므로 아래 리셋 effect의 의존성에 넣으면
  // 모달이 열린 채 재발화해 **사용자가 입력한 값을 지운다**. ref는 반응형 의존성이 아니라서
  // effect가 실제로 실행되는 순간의 최신값만 읽게 된다.
  // ⚠ 렌더 중 ref 대입은 금지(react-hooks/refs) — 반드시 effect에서, 그리고 아래 리셋 effect보다
  //   **먼저** 선언해 같은 커밋에서 미러가 먼저 갱신되게 한다.
  const tradePlanRowsRef = useRef(derived.tradePlanRows);
  useEffect(() => { tradePlanRowsRef.current = derived.tradePlanRows; }, [derived.tradePlanRows]);

  useEffect(() => {
    if (asset && isOpen) {
      setSubmitAttempted(false);
      setSellDate(new Date().toISOString().slice(0, 10));
      setAddToTurtleWatch(true);
      const activePlan = asset.tradePlan && asset.tradePlan.status === 'active' ? asset.tradePlan : null;
      if (activePlan) {
        // 계획 카드에서 열었으면 그쪽 프리필이 우선, 아니면 현재 신호로 기본 효과를 고른다.
        const row = tradePlanRowsRef.current.find(r => r.asset.id === asset.id);
        const outcome = modal.sellPrefill?.outcome ?? defaultSellOutcome(row?.evaluation ?? null);
        const prefill = sellPrefillFor(activePlan, asset, outcome);
        setSellOutcome(outcome);
        setSellQuantity(String(modal.sellPrefill?.quantity ?? prefill.quantity));
        setSellPrice(String(modal.sellPrefill?.price ?? prefill.priceOriginal));
      } else {
        setSellOutcome('none');
        // 현재가를 자산 통화 기준으로 표시
        setSellPrice(asset.currentPrice.toString());
        setSellQuantity(asset.quantity.toString());
      }
    }
  }, [asset, isOpen, modal.sellPrefill]);

  if (!isOpen || !asset) return null;

  const isCrypto = isBaseType(asset.categoryId, 'CRYPTOCURRENCY');
  const activePlan = asset.tradePlan && asset.tradePlan.status === 'active' ? asset.tradePlan : null;

  /** 효과를 바꾸면 수량·가격도 그 효과의 기본값으로 다시 채운다(사용자는 이후 자유 수정). */
  const handleOutcomeChange = (outcome: SellOutcome) => {
    setSellOutcome(outcome);
    if (!activePlan) return;
    const prefill = sellPrefillFor(activePlan, asset, outcome);
    setSellQuantity(String(prefill.quantity));
    setSellPrice(String(prefill.priceOriginal));
  };

  const parsedSellQty = parseFloat(sellQuantity);
  // 검증 단계(순서 = 문구 우선순위). 문구와 필드별 aria-invalid가 같은 판정에서 나온다 —
  // 지금 보이는 문구가 가리키는 필드에만 오류 표시(렌더 중 파생값, 상태 추가 없음).
  const missingFields = !sellDate || !sellPrice || !sellQuantity;
  const quantityOutOfRange = !missingFields && !(parsedSellQty > 0 && parsedSellQty <= asset.quantity);
  const priceNotPositive = !missingFields && !quantityOutOfRange && !(parseFloat(sellPrice) > 0);
  const formError = missingFields
    ? '모든 필드를 입력해주세요.'
    : quantityOutOfRange
      ? `매도 수량은 0보다 크고 보유 수량(${asset.quantity}) 이하여야 합니다.`
      : priceNotPositive
        ? '매도가는 0보다 커야 합니다.'
        : null;
  const errorShown = submitAttempted && formError !== null;
  const dateInvalid = errorShown && missingFields && !sellDate;
  const priceInvalid = errorShown && ((missingFields && !sellPrice) || priceNotPositive);
  const quantityInvalid = errorShown && ((missingFields && !sellQuantity) || quantityOutOfRange);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formError) {
      setSubmitAttempted(true);
      return;
    }

    const quantity = parseFloat(sellQuantity);
    const price = parseFloat(sellPrice);

    // 자산의 원래 통화로 매도 처리 — recordTurtleSell이 confirmSell을 감싸 돈 기록 성공 후에만
    // (범위 내 + 체크됐을 때) "다시 살 때 감시" 등록까지 한 번에 처리한다(계획서 §4.2, §5-2).
    const result = await actions.recordTurtleSell({
      assetId: asset.id,
      sellQuantity: quantity,
      sellPrice: price,       // 자산 통화 기준 매도가
      sellDate,
      settlementCurrency: asset.currency,
      addToWatchlist: inHoldingsScope && addToTurtleWatch,
    });

    // 매매 계획 상태 전이(P2b) — 돈 기록이 성공하고 자산이 남아 있을 때만.
    // 전량 매도로 자산이 사라졌으면(assetClosed) 계획을 얹을 대상이 없다.
    if (result.ok && !result.assetClosed && activePlan && sellOutcome !== 'none') {
      actions.applyTradePlanSellOutcome(asset.id, sellOutcome, {
        date: sellDate, price, quantity, sellRecordId: result.sellRecordId,
      });
    }
  };

  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";

  const formatCurrency = (num: number, currency: Currency): string => {
    if (currency === Currency.KRW) {
      return new Intl.NumberFormat('ko-KR', { 
        style: 'currency', 
        currency: 'KRW', 
        maximumFractionDigits: 0 
      }).format(num);
    }
    if (currency === Currency.JPY) {
      return `${CURRENCY_SYMBOLS[currency]}${new Intl.NumberFormat('ja-JP', { 
        maximumFractionDigits: 0 
      }).format(num)}`;
    }
    return `${CURRENCY_SYMBOLS[currency]}${new Intl.NumberFormat('en-US', { 
      minimumFractionDigits: 2,
      maximumFractionDigits: 2 
    }).format(num)}`;
  };

  const currencySymbol = CURRENCY_SYMBOLS[asset.currency];
  const currencyLabel = asset.currency;

  // 예상 매도금액 계산
  const estimatedTotal = parseFloat(sellPrice || '0') * parseFloat(sellQuantity || '0');

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={`매도: ${asset.customName?.trim() || asset.name}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          {/* 매도 제출도 primary + 명시 라벨(파랑 채움 버튼 금지 — RULES.md §8 색 규약) */}
          <Button type="submit" form="sell-asset-form" variant="primary" loading={isLoading}>
            매도
          </Button>
        </>
      }
    >
        <form id="sell-asset-form" onSubmit={handleSubmit} className="space-y-4">
          {/* 보유 정보 */}
          <div className="bg-gray-700 p-4 rounded-md">
            <div className={labelClasses}>보유정보</div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-gray-400">보유 수량</div>
                <div className="text-white font-semibold">
                  {formatQuantity(asset.quantity, isCrypto)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">현재가</div>
                <div className="text-white font-semibold">
                  {formatCurrency(asset.currentPrice, asset.currency)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">평가금액</div>
                <div className="text-white font-semibold">
                  {formatCurrency(asset.currentPrice * asset.quantity, asset.currency)}
                </div>
              </div>
            </div>
          </div>

          {/* 매매 계획 연동 (P2b) — 활성 계획이 있을 때만. 선택에 따라 수량·가격이 다시 채워진다 */}
          {activePlan && (
            <div className="bg-gray-700/50 p-3 rounded-md">
              <div className={labelClasses}>이 매도가 계획에 미치는 효과</div>
              <Segmented<SellOutcome>
                bordered={false}
                className="grid grid-cols-2 sm:grid-cols-4 gap-1.5"
                options={SELL_OUTCOME_OPTIONS.map(opt => ({ value: opt.value, label: opt.label }))}
                value={sellOutcome}
                onChange={handleOutcomeChange}
              />
              <p className="text-xs text-gray-500 mt-2">
                {SELL_OUTCOME_OPTIONS.find(o => o.value === sellOutcome)?.hint}
              </p>
            </div>
          )}

          {/* 통화 표시 (변경 불가) */}
          <div className="bg-gray-700/50 p-3 rounded-md">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">매도 통화</span>
              <span className="text-white font-medium flex items-center gap-2">
                {currencyLabel}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              * 매수 통화와 동일한 통화로만 매도할 수 있습니다.
            </p>
          </div>

          {/* 매도일자 */}
          <div>
            <label htmlFor="sellDate" className={labelClasses}>매도일자</label>
            <input
              id="sellDate"
              type="date"
              value={sellDate}
              onChange={(e) => setSellDate(e.target.value)}
              className={inputClasses}
              required
              aria-invalid={dateInvalid || undefined}
              aria-describedby={dateInvalid ? formErrorId : undefined}
            />
          </div>

          {/* 매도가 */}
          <div>
            <label htmlFor="sellPrice" className={labelClasses}>
              매도가 ({currencySymbol})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                {currencySymbol}
              </span>
              <input
                id="sellPrice"
                type="number"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                className={`${inputClasses} pl-8`}
                required
                min="0"
                step="any"
                placeholder="매도가를 입력하세요"
                aria-invalid={priceInvalid || undefined}
                aria-describedby={priceInvalid ? formErrorId : undefined}
              />
            </div>
          </div>

          {/* 매도 수량 */}
          <div>
            <label htmlFor="sellQuantity" className={labelClasses}>매도 수량</label>
            <input
              id="sellQuantity"
              type="number"
              value={sellQuantity}
              onChange={(e) => setSellQuantity(e.target.value)}
              className={inputClasses}
              required
              min={isCrypto ? "0.00000001" : "1"}
              max={asset.quantity}
              step="any"
              placeholder="매도할 수량을 입력하세요"
              aria-invalid={quantityInvalid || undefined}
              aria-describedby={quantityInvalid ? formErrorId : undefined}
            />
            <div className="flex justify-between mt-1">
              <button
                type="button"
                onClick={() => setSellQuantity(asset.quantity.toString())}
                className="text-xs text-primary hover:text-primary-light"
              >
                전량 매도
              </button>
              <span className="text-xs text-gray-500">
                최대: {formatQuantity(asset.quantity, isCrypto)}
              </span>
            </div>
          </div>

          {/* 예상 매도금액 */}
          {estimatedTotal > 0 && (
            <div className="bg-gray-900 p-4 rounded-md">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">예상 매도금액</span>
                <span className="text-xl font-bold text-white">
                  {formatCurrency(estimatedTotal, asset.currency)}
                </span>
              </div>
            </div>
          )}

          {/* "보유종목 터틀" 감시 명단 추가(계획서 §4.2) — 범위 내 자산만, 기본 켬 */}
          {inHoldingsScope && (
            <label className="flex items-start gap-2 bg-gray-700/50 p-3 rounded-md cursor-pointer">
              <input
                type="checkbox"
                checked={addToTurtleWatch}
                onChange={(e) => setAddToTurtleWatch(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span className="text-sm text-gray-200">
                "다시 살 때" 감시 명단에 추가
                <span className="block text-xs text-gray-500 mt-0.5">
                  체크하면 이 종목이 55일 최고가를 돌파할 때 재매수 후보로 알려 드립니다. (전량 매도일 때만 적용)
                </span>
              </span>
            </label>
          )}

          {errorShown && <FieldError id={formErrorId}>{formError}</FieldError>}
        </form>
    </Modal>
  );
};

export default SellAssetModal;
