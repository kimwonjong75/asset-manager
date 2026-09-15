// components/BuyMoreAssetModal.tsx
// 보유 종목 추가매수 모달

import React, { useState, useEffect, useRef } from 'react';
import { Asset, Currency, CURRENCY_SYMBOLS } from '../types';
import { isBaseType } from '../types/category';
import { formatQuantity } from './portfolio-table/utils';
import { usePortfolio } from '../contexts/PortfolioContext';
import PositionSizingCalculator from './common/PositionSizingCalculator';
import Modal from './common/Modal';
import Button from './common/Button';
import { CircleAlert, ChevronDown, ChevronUp, Shield, TriangleAlert } from 'lucide-react';
import TradePlanEditor, { type TradePlanEditorHandle } from './trade-plan/TradePlanEditor';
import { buildTradePlan, nextPyramidStep, formatPlanPrice } from '../utils/tradePlan';
import { defaultEditorInput, fxRateToKRWFor } from '../utils/tradePlanMarket';
import { pyramidPrecheck } from '../utils/tradePlanLink';
import { DEFAULT_TRADE_PLAN_TEMPLATE, type TradePlan } from '../types/tradePlan';

const BuyMoreAssetModal: React.FC = () => {
  const { modal, actions, status, data, derived } = usePortfolio();
  const asset = modal.buyingAsset;
  const isOpen = !!modal.buyingAsset;
  const onClose = actions.closeBuyModal;
  const isLoading = status.isLoading;

  const [buyDate, setBuyDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [buyPrice, setBuyPrice] = useState<string>('');
  const [buyQuantity, setBuyQuantity] = useState<string>('');

  // 매매 계획으로 저장(P2a) — 활성 계획이 **없는** 종목에서만 제안. 활성 계획이 있으면 불타기 경로(P2b).
  const [saveTradePlanOnBuy, setSaveTradePlanOnBuy] = useState(true);
  const [showTradePlanDetail, setShowTradePlanDetail] = useState(false);
  const tradePlanEditorRef = useRef<TradePlanEditorHandle>(null);

  // 이 추가매수를 불타기 체결로 기록할지 (P2b)
  const [pyramidChecked, setPyramidChecked] = useState(false);
  // 제출 시도 후에만 인라인 검증 문구 노출(브라우저 alert 대체 — RULES.md §7)
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // 최신 평가 행은 ref로 미러링한다(usePriceFreshnessRefresh와 동일 접근) — derived.tradePlanRows는
  // 배경 시세 갱신마다 참조가 바뀌므로 아래 리셋 effect의 의존성에 넣으면 모달이 열린 채 재발화해
  // 사용자가 입력한 값을 지운다.
  // ⚠ 렌더 중 ref 대입은 금지(react-hooks/refs) — effect에서, 리셋 effect보다 **먼저** 선언한다.
  const tradePlanRowsRef = useRef(derived.tradePlanRows);
  useEffect(() => { tradePlanRowsRef.current = derived.tradePlanRows; }, [derived.tradePlanRows]);

  useEffect(() => {
    if (asset && isOpen) {
      setBuyDate(new Date().toISOString().slice(0, 10));
      setBuyPrice(asset.currentPrice.toString());
      setBuyQuantity('');
      setSaveTradePlanOnBuy(true);
      setShowTradePlanDetail(false);
      // 불타기 신호(도달·근접)에서 열었을 때만 체크박스를 기본 ON으로 제안한다.
      const activePlan = asset.tradePlan && asset.tradePlan.status === 'active' ? asset.tradePlan : null;
      const step = activePlan && activePlan.pyramid.enabled ? nextPyramidStep(activePlan) : null;
      if (step) {
        const row = tradePlanRowsRef.current.find(r => r.asset.id === asset.id);
        const sig = row?.evaluation.signal;
        setPyramidChecked(sig === 'pyramid-hit' || sig === 'near-pyramid');
      } else {
        setPyramidChecked(false);
      }
    }
  }, [asset, isOpen]);

  if (!isOpen || !asset) return null;

  const activePlan = asset.tradePlan && asset.tradePlan.status === 'active' ? asset.tradePlan : null;
  const hasActivePlan = activePlan !== null;

  // 불타기 사전 검사(P2b) — 입력값이 갖춰졌을 때만. 커밋 전에 4중 검사를 미리 돌려
  // "체크는 되는데 눌러보면 안 되는" 상황을 없앤다(가드 순서는 applyPyramidFill과 동일).
  const pyramidStep = activePlan && activePlan.pyramid.enabled ? nextPyramidStep(activePlan) : null;
  const fx = fxRateToKRWFor(asset.currency, data.exchangeRates);
  const precheck = activePlan && pyramidStep && buyPrice !== '' && buyQuantity !== ''
    ? pyramidPrecheck(
        activePlan,
        { date: buyDate, price: parseFloat(buyPrice) || 0, quantity: parseFloat(buyQuantity) || 0 },
        fx,
      )
    : null;
  const pyramidGateOk = precheck ? precheck.ok : true;

  const formError = (!buyDate || !buyPrice || !buyQuantity)
    ? '모든 필드를 입력해주세요.'
    : !(parseFloat(buyQuantity) > 0)
      ? '매수 수량은 0보다 커야 합니다.'
      : !(parseFloat(buyPrice) > 0)
        ? '매수가는 0보다 커야 합니다.'
        : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formError) {
      setSubmitAttempted(true);
      return;
    }

    const quantity = parseFloat(buyQuantity);
    const price = parseFloat(buyPrice);

    const result = await actions.confirmBuyMore(asset.id, buyDate, price, quantity);

    // 불타기 체결 기록(P2b) — 이미 활성 계획이 있고, 남은 단계가 있고, 사전 검사를 통과했을 때만.
    // 매수 자체는 이미 확정됐다 — 계획 반영이 실패해도 롤백하지 않는다(액션이 사유를 표면화).
    if (result.ok && hasActivePlan && pyramidStep && pyramidChecked && pyramidGateOk) {
      actions.applyTradePlanPyramidFill(asset.id, { date: buyDate, price, quantity });
    }

    // 매매 계획 저장 — 활성 계획이 없던 종목에서만, 추가매수 성공 후 별도 커밋(P2a).
    // 이미 활성 계획이 있으면 새 계획을 만들지 않는다(그 경로는 위의 불타기 체결 기록).
    if (result.ok && !hasActivePlan && saveTradePlanOnBuy) {
      let plan: TradePlan | null = null;
      if (showTradePlanDetail && tradePlanEditorRef.current) {
        const r = tradePlanEditorRef.current.getResult();
        if (r.ok) plan = r.plan;
      } else {
        const input = defaultEditorInput(
          { kind: 'asset', asset: result.updatedAsset },
          { totalEquityKRW: derived.totalValue, rates: data.exchangeRates, enriched: undefined, now: new Date().toISOString(), anchor: 'today' },
        );
        const r = buildTradePlan(input);
        if (r.ok) plan = r.plan;
      }
      if (plan) actions.saveTradePlan(result.assetId, plan);
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

  // 예상 매수금액 계산
  const estimatedTotal = parseFloat(buyPrice || '0') * parseFloat(buyQuantity || '0');

  // 매수 후 예상 평균단가
  const newQuantity = asset.quantity + (parseFloat(buyQuantity || '0') || 0);
  const newAvgPrice = newQuantity > 0
    ? (asset.quantity * asset.purchasePrice + (parseFloat(buyQuantity || '0') || 0) * (parseFloat(buyPrice || '0') || 0)) / newQuantity
    : 0;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={`추가매수: ${asset.customName?.trim() || asset.name}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button type="submit" form="buy-more-asset-form" variant="primary" loading={isLoading}>
            추가매수 확인
          </Button>
        </>
      }
    >
        <form id="buy-more-asset-form" onSubmit={handleSubmit} className="space-y-4">
          {/* 보유 정보 */}
          <div className="bg-gray-700 p-4 rounded-md">
            <div className={labelClasses}>보유정보</div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-gray-400">보유 수량</div>
                <div className="text-white font-semibold">
                  {formatQuantity(asset.quantity, isBaseType(asset.categoryId, 'CRYPTOCURRENCY'))}
                </div>
              </div>
              <div>
                <div className="text-gray-400">매수평균가</div>
                <div className="text-white font-semibold">
                  {formatCurrency(asset.purchasePrice, asset.currency)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">현재가</div>
                <div className="text-white font-semibold">
                  {formatCurrency(asset.currentPrice, asset.currency)}
                </div>
              </div>
            </div>
          </div>

          {/* 통화 표시 (변경 불가) */}
          <div className="bg-gray-700/50 p-3 rounded-md">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">매수 통화</span>
              <span className="text-white font-medium flex items-center gap-2">
                {currencyLabel}
              </span>
            </div>
          </div>

          {/* 매수일자 */}
          <div>
            <label htmlFor="buyDate" className={labelClasses}>매수일자</label>
            <input
              id="buyDate"
              type="date"
              value={buyDate}
              onChange={(e) => setBuyDate(e.target.value)}
              className={inputClasses}
              required
            />
          </div>

          {/* 매수가 */}
          <div>
            <label htmlFor="buyPrice" className={labelClasses}>
              매수가 ({currencySymbol})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                {currencySymbol}
              </span>
              <input
                id="buyPrice"
                type="number"
                value={buyPrice}
                onChange={(e) => setBuyPrice(e.target.value)}
                className={`${inputClasses} pl-8`}
                required
                min="0"
                step="any"
                placeholder="매수가를 입력하세요"
              />
            </div>
          </div>

          {/* 매수 수량 */}
          <div>
            <label htmlFor="buyQuantity" className={labelClasses}>매수 수량</label>
            <input
              id="buyQuantity"
              type="number"
              value={buyQuantity}
              onChange={(e) => setBuyQuantity(e.target.value)}
              className={inputClasses}
              required
              min="1"
              step="any"
              placeholder="추가 매수할 수량을 입력하세요"
            />
          </div>

          {/* 리스크 기반 권장 수량 (선택) */}
          <div className="bg-gray-700/40 p-3 rounded-md">
            <div className={`${labelClasses} flex items-center gap-1.5`}>
              <Shield className="h-4 w-4 text-gray-400" aria-hidden="true" /><span>리스크 기반 권장 수량</span>
              <span className="text-xs text-gray-500 font-normal">(위 매수가 기준)</span>
            </div>
            <PositionSizingCalculator
              totalEquityKRW={derived.totalValue}
              currency={asset.currency}
              exchangeRates={data.exchangeRates}
              entryPrice={parseFloat(buyPrice) || 0}
              allowFractional={isBaseType(asset.categoryId, 'CRYPTOCURRENCY')}
              onApplyQuantity={(qty) => setBuyQuantity(String(qty))}
            />
          </div>

          {/* 활성 계획 있음 → 불타기 체결 기록(P2b) / 없음 → 새 계획 저장 제안(P2a) */}
          {hasActivePlan ? (
            pyramidStep ? (
              <div className="bg-gray-700/40 p-3 rounded-md space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pyramidChecked && pyramidGateOk}
                    disabled={!pyramidGateOk}
                    onChange={(e) => setPyramidChecked(e.target.checked)}
                    className="cursor-pointer"
                  />
                  이 추가매수는 불타기 {pyramidStep.level}차로 기록 (계획 {pyramidStep.plannedQuantity}주 · 트리거 {formatPlanPrice(pyramidStep.triggerPrice, asset.currency)})
                </label>
                {precheck && !precheck.ok && (
                  <p className="flex items-center gap-1 text-xs text-amber-400"><TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{precheck.label}</p>
                )}
                {precheck && precheck.ok && (
                  <p className="text-xs text-ok">
                    기록 시 손절선이 {formatPlanPrice(precheck.nextPlan.stopPrice, asset.currency)}로 올라갑니다
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500 bg-gray-700/30 rounded-md px-3 py-2">
                {activePlan && !activePlan.pyramid.enabled
                  ? '이 계획은 불타기를 쓰지 않습니다 — 추가매수는 계획에 반영되지 않고 기록만 됩니다.'
                  : '불타기 단계를 모두 사용했습니다 — 추가매수는 계획에 반영되지 않고 기록만 됩니다.'}
              </p>
            )
          ) : (
            <div className="bg-gray-700/40 p-3 rounded-md space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveTradePlanOnBuy}
                  onChange={(e) => setSaveTradePlanOnBuy(e.target.checked)}
                  className="cursor-pointer"
                />
                이 계획으로 저장 (손절선·익절선·추세선)
              </label>
              {saveTradePlanOnBuy && (
                <>
                  <p className="text-xs text-gray-400">
                    기본값: 손절 {DEFAULT_TRADE_PLAN_TEMPLATE.stopPct}% · 익절 {DEFAULT_TRADE_PLAN_TEMPLATE.profitMultiple}배
                    {DEFAULT_TRADE_PLAN_TEMPLATE.exitLine.kind === 'ma' && ` · ${DEFAULT_TRADE_PLAN_TEMPLATE.exitLine.period}일선`} · 불타기 안 함
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowTradePlanDetail(v => !v)}
                    className="text-xs text-primary-light hover:underline"
                  >
                    {showTradePlanDetail
                      ? <>자세히 접기 <ChevronUp className="inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" /></>
                      : <>자세히 <ChevronDown className="inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" /></>}
                  </button>
                  {showTradePlanDetail && (
                    <TradePlanEditor ref={tradePlanEditorRef} embedded target={{ kind: 'asset', asset }} />
                  )}
                </>
              )}
            </div>
          )}

          {/* 예상 매수금액 & 변경 후 평균단가 */}
          {estimatedTotal > 0 && (
            <div className="bg-gray-900 p-4 rounded-md space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">예상 매수금액</span>
                <span className="text-xl font-bold text-white">
                  {formatCurrency(estimatedTotal, asset.currency)}
                </span>
              </div>
              <div className="flex justify-between items-center border-t border-gray-700 pt-2">
                <span className="text-gray-400">변경 후 평균단가</span>
                <span className="text-sm font-semibold text-primary-light">
                  {formatCurrency(newAvgPrice, asset.currency)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">변경 후 총 수량</span>
                <span className="text-sm font-semibold text-white">
                  {newQuantity.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {submitAttempted && formError && (
            <p className="flex items-center gap-1.5 text-danger text-sm" role="alert"><CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />{formError}</p>
          )}
        </form>
    </Modal>
  );
};

export default BuyMoreAssetModal;
