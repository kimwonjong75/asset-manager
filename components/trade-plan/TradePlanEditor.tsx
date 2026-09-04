// components/trade-plan/TradePlanEditor.tsx
// 매매 계획 편집기 — 렌더 전용. 계산은 `buildTradePlan`(utils/tradePlan.ts) 하나만 쓴다(로컬 재계산 금지).
// 항목마다 한 줄 설명 + 숫자 예시(계획서 §4.6). [계획 보기] → 미리보기 → [저장]/[취소].
//
// `embedded` 모드: AddNewAssetModal/BuyMoreAssetModal의 "자세히" 토글에서 쓴다 — 아직 자산이
// 생성되지 않은 시점이라 이 컴포넌트 스스로 저장할 수 없다. intro·저장/취소 푸터를 숨기고,
// 최신 빌드 결과를 `ref.getResult()`로 부모(모달의 최종 제출 핸들러)에 넘긴다.

import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { Currency } from '../../types';
import { isBaseType } from '../../types/category';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { buildTradePlan, formatPlanPrice } from '../../utils/tradePlan';
import { fxRateToKRWFor, defaultEditorInput, type TradePlanTarget } from '../../utils/tradePlanMarket';
import { localDateString } from '../../utils/localDate';
import {
  TRADE_PLAN_BUILD_ERROR_LABELS,
  PLAN_ADVERSE_GAP_PCT,
  type TradePlan,
  type TradePlanAnchor,
  type TradePlanBuildInput,
  type ExitLinePeriod,
  type PyramidStepUnit,
  type PyramidSizing,
  type PyramidLevel,
} from '../../types/tradePlan';
import TradePlanIntro, { hasSeenTradePlanIntro } from './TradePlanIntro';
import Segmented from '../common/Segmented';

const RISK_PRESETS = [0.5, 1, 2] as const;
const STOP_PRESETS = [3, 5, 7, 8, 10] as const;
const PROFIT_MULTIPLES = [2, 3, 4] as const;
const EXIT_PERIODS: ExitLinePeriod[] = [10, 20, 50];

interface EditorForm {
  anchorMode: TradePlanAnchor;
  customAnchorPrice: string;
  totalEquityInput: string;
  riskPreset: number | 'custom';
  riskCustom: string;
  stopMode: 'pct' | 'price';
  stopPreset: number | 'custom';
  stopPctCustom: string;
  stopPriceCustom: string;
  profitMultiple: 2 | 3 | 4 | null;
  exitLineKind: 'ma' | 'price';
  exitLinePeriod: ExitLinePeriod;
  exitLinePriceCustom: string;
  pyramidEnabled: boolean;
  pyramidStepUnit: PyramidStepUnit;
  pyramidStep: string;
  pyramidSizing: PyramidSizing;
  pyramidMaxAdds: PyramidLevel;
  brokerStopOrderRegistered: boolean;
}

function buildSeed(existingPlan: TradePlan | undefined, defaults: TradePlanBuildInput): EditorForm {
  if (existingPlan) {
    return {
      anchorMode: existingPlan.anchor,
      customAnchorPrice: existingPlan.anchor === 'custom' ? String(existingPlan.anchorPrice) : '',
      totalEquityInput: String(Math.round(existingPlan.totalEquityKRW)),
      riskPreset: (RISK_PRESETS as readonly number[]).includes(existingPlan.riskPct) ? existingPlan.riskPct : 'custom',
      riskCustom: String(existingPlan.riskPct),
      stopMode: 'pct',
      stopPreset: (STOP_PRESETS as readonly number[]).includes(existingPlan.stopPct) ? existingPlan.stopPct : 'custom',
      stopPctCustom: String(existingPlan.stopPct),
      stopPriceCustom: String(existingPlan.stopPrice),
      profitMultiple: existingPlan.profitMultiple,
      exitLineKind: existingPlan.exitLine.kind,
      exitLinePeriod: existingPlan.exitLine.kind === 'ma' ? existingPlan.exitLine.period : 20,
      exitLinePriceCustom: existingPlan.exitLine.kind === 'price' ? String(existingPlan.exitLine.price) : '',
      pyramidEnabled: existingPlan.pyramid.enabled,
      pyramidStepUnit: existingPlan.pyramid.stepUnit,
      pyramidStep: String(existingPlan.pyramid.step),
      pyramidSizing: existingPlan.pyramid.sizing,
      pyramidMaxAdds: existingPlan.pyramid.maxAdds,
      brokerStopOrderRegistered: existingPlan.brokerStopOrderRegistered,
    };
  }
  return {
    anchorMode: defaults.anchor,
    customAnchorPrice: String(defaults.anchorPrice),
    totalEquityInput: String(Math.round(defaults.totalEquityKRW)),
    riskPreset: defaults.riskPct,
    riskCustom: String(defaults.riskPct),
    stopMode: 'pct',
    stopPreset: defaults.stopPct ?? 7,
    stopPctCustom: String(defaults.stopPct ?? 7),
    stopPriceCustom: '',
    profitMultiple: defaults.profitMultiple,
    exitLineKind: defaults.exitLine.kind,
    exitLinePeriod: defaults.exitLine.kind === 'ma' ? defaults.exitLine.period : 20,
    exitLinePriceCustom: '',
    pyramidEnabled: defaults.pyramid.enabled,
    pyramidStepUnit: defaults.pyramid.stepUnit,
    pyramidStep: String(defaults.pyramid.step),
    pyramidSizing: defaults.pyramid.sizing,
    pyramidMaxAdds: defaults.pyramid.maxAdds,
    brokerStopOrderRegistered: false,
  };
}

function fmtKRW(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

// P6: 단일 값 그룹(기준가/최대손실/익절배수/불타기 하위 3종)은 `common/Segmented`로 교체했다.
// 이 로컬 `SegButton`은 손절폭·추세선·불타기 on/off처럼 **한 버튼 줄이 두 상태를 동시에 표현**하는
// 복합 그룹에만 남겨 둔다(예: 손절폭 줄은 stopMode+stopPreset을 같이 토글) — Segmented의
// 단일 value/onChange 계약에 억지로 끼워 맞추면 오히려 읽기 어려워진다는 판단(계획서 P6 지침).
const SegButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode; title?: string }> = ({
  active, onClick, children, title,
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${
      active ? 'bg-primary border-primary text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
    }`}
  >
    {children}
  </button>
);

const FieldHint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{children}</p>
);

export interface TradePlanEditorHandle {
  /** 현재 폼 값으로 빌드한 최신 결과 — embedded 모드에서 부모(모달 제출 핸들러)가 읽는다 */
  getResult: () => ReturnType<typeof buildTradePlan>;
}

export interface TradePlanEditorProps {
  target: TradePlanTarget;
  /** 기존 활성 계획 — 있으면 그 값으로 초기화(수정), 없으면 강의 기본값으로 초기화(신규) */
  existingPlan?: TradePlan;
  onSave?: (plan: TradePlan) => void;
  onCancel?: () => void;
  className?: string;
  /** true면 intro·저장/취소 푸터를 숨기고 ref.getResult()로만 값을 노출(AddNewAssetModal 등) */
  embedded?: boolean;
}

const TradePlanEditor = forwardRef<TradePlanEditorHandle, TradePlanEditorProps>(function TradePlanEditor(
  { target, existingPlan, onSave, onCancel, className = '', embedded = false },
  ref,
) {
  const { derived, data } = usePortfolio();
  const rates = data.exchangeRates;
  const ticker = target.kind === 'asset' ? target.asset.ticker : target.item.ticker;
  const enriched = derived.enrichedMap.get(ticker);
  const currency: Currency = target.kind === 'asset' ? target.asset.currency : (target.item.currency ?? Currency.KRW);
  const categoryId = target.kind === 'asset' ? target.asset.categoryId : target.item.categoryId;
  const isCrypto = isBaseType(categoryId, 'CRYPTOCURRENCY');

  const [now] = useState<string>(() => new Date().toISOString());
  const [showIntro, setShowIntro] = useState<boolean>(() => !hasSeenTradePlanIntro());
  const [showPreview, setShowPreview] = useState(false);

  const [form, setForm] = useState<EditorForm>(() => {
    const defaults = defaultEditorInput(target, {
      totalEquityKRW: derived.totalValue, rates, enriched, now, anchor: 'today',
    });
    return buildSeed(existingPlan, defaults);
  });
  const set = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => setForm(f => ({ ...f, [key]: value }));

  const purchasePrice = target.kind === 'asset' ? target.asset.purchasePrice : null;
  const todayPrice = target.kind === 'asset' ? target.asset.priceOriginal : (target.item.priceOriginal ?? target.item.currentPrice ?? 0);

  const anchorPrice =
    form.anchorMode === 'today' ? todayPrice :
    form.anchorMode === 'purchase' ? (purchasePrice ?? 0) :
    (parseFloat(form.customAnchorPrice) || 0);

  const riskPct = form.riskPreset === 'custom' ? (parseFloat(form.riskCustom) || 0) : form.riskPreset;
  const stopPctVal = form.stopPreset === 'custom' ? (parseFloat(form.stopPctCustom) || 0) : form.stopPreset;
  const totalEquityKRW = parseFloat(form.totalEquityInput) || 0;
  const fx = fxRateToKRWFor(currency, rates);
  const currentExitLineValue = form.exitLineKind === 'ma' ? (enriched?.ma[form.exitLinePeriod] ?? null) : null;

  const buildInput: TradePlanBuildInput = {
    mode: target.kind === 'asset' ? 'holding' : 'new-buy',
    anchor: form.anchorMode,
    anchorPrice,
    anchorDate: form.anchorMode === 'purchase' && target.kind === 'asset' ? target.asset.purchaseDate : localDateString(new Date(now)),
    currency,
    totalEquityKRW,
    riskPct,
    ...(form.stopMode === 'price' ? { stopPrice: parseFloat(form.stopPriceCustom) || 0 } : { stopPct: stopPctVal }),
    profitMultiple: form.profitMultiple,
    exitLine: form.exitLineKind === 'ma' ? { kind: 'ma', period: form.exitLinePeriod } : { kind: 'price', price: parseFloat(form.exitLinePriceCustom) || 0 },
    currentExitLineValue,
    pyramid: {
      enabled: form.pyramidEnabled,
      stepUnit: form.pyramidStepUnit,
      step: parseFloat(form.pyramidStep) || 0,
      sizing: form.pyramidSizing,
      maxAdds: form.pyramidMaxAdds,
    },
    holdingQuantity: target.kind === 'asset' ? target.asset.quantity : undefined,
    fxRateToKRW: fx,
    allowFractional: isCrypto,
    now,
    brokerStopOrderRegistered: form.brokerStopOrderRegistered,
  };
  const result = buildTradePlan(buildInput);
  useImperativeHandle(ref, () => ({ getResult: () => result }), [result]);

  const inputClasses =
    'w-full bg-gray-700 border border-gray-600 rounded-md py-1.5 px-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition';
  const labelClasses = 'block text-xs font-medium text-gray-300 mb-1';

  const isLosingOnPurchaseAnchor = form.anchorMode === 'purchase' && purchasePrice !== null && todayPrice > 0 && todayPrice < purchasePrice;

  const handleSave = () => {
    if (result.ok) onSave?.(result.plan);
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {!embedded && showIntro && <TradePlanIntro onDismiss={() => setShowIntro(false)} />}

      {/* 모드 (자동 결정, 편집 불가) */}
      <div>
        <div className={labelClasses}>모드</div>
        <div className="bg-gray-700/50 border border-gray-600 rounded-md px-3 py-2 text-sm text-gray-200">
          {target.kind === 'asset' ? '보유 종목 계획' : '신규 매수 계획'}
        </div>
        <FieldHint>
          {target.kind === 'asset'
            ? '이미 갖고 있는 종목이라 수량은 그대로, 규칙은 오늘 가격부터 시작합니다.'
            : '아직 사지 않은 종목입니다 — 계획을 먼저 세우고, 실제로 매수를 기록하면 이 계획이 그대로 이어집니다.'}
        </FieldHint>
      </div>

      {/* 기준가 */}
      <div>
        <div className={labelClasses}>기준가</div>
        <Segmented<TradePlanAnchor>
          options={[
            { value: 'today', label: '오늘가' },
            ...(target.kind === 'asset' ? [{ value: 'purchase' as TradePlanAnchor, label: '매수가' }] : []),
            { value: 'custom', label: '직접 입력' },
          ]}
          value={form.anchorMode}
          onChange={(v) => set('anchorMode', v)}
        />
        {form.anchorMode === 'custom' && (
          <input
            type="number" min="0" step="any" value={form.customAnchorPrice}
            onChange={(e) => set('customAnchorPrice', e.target.value)}
            placeholder="기준가"
            className={`${inputClasses} mt-1.5`}
          />
        )}
        <FieldHint>
          {`기준가 = 계획의 출발점입니다. 현재 ${anchorPrice > 0 ? formatPlanPrice(anchorPrice, currency) : '미입력'}.`}
          {isLosingOnPurchaseAnchor && (
            <span className="block mt-0.5 text-amber-400">⚠ 매수가가 현재가보다 높습니다 — 이미 손절선 아래로 시작됩니다.</span>
          )}
        </FieldHint>
      </div>

      {/* 총자산 */}
      <div>
        <label className={labelClasses}>총자산 (₩)</label>
        <input
          type="number" min="0" step="any" value={form.totalEquityInput}
          onChange={(e) => set('totalEquityInput', e.target.value)}
          className={inputClasses}
        />
        <FieldHint>계획의 기준이 되는 총자산입니다. 기본값은 현재 포트폴리오 평가총액입니다.</FieldHint>
      </div>

      {/* 최대손실 */}
      <div>
        <div className={labelClasses}>최대손실</div>
        <Segmented<number | 'custom'>
          options={[
            ...RISK_PRESETS.map(p => ({ value: p as number | 'custom', label: `${p}%` })),
            { value: 'custom', label: '직접' },
          ]}
          value={form.riskPreset}
          onChange={(v) => set('riskPreset', v)}
        />
        {form.riskPreset === 'custom' && (
          <input
            type="number" min="0" max="100" step="0.1" value={form.riskCustom}
            onChange={(e) => set('riskCustom', e.target.value)}
            className={`${inputClasses} mt-1.5`}
          />
        )}
        <FieldHint>
          {`최대손실 ${riskPct}% = 총자산 ${totalEquityKRW > 0 ? fmtKRW(totalEquityKRW) : '?'}이면 이 종목에서 최대 ${totalEquityKRW > 0 ? fmtKRW(totalEquityKRW * riskPct / 100) : '?'}만 잃습니다.`}
        </FieldHint>
      </div>

      {/* 손절폭 */}
      <div>
        <div className={labelClasses}>손절폭</div>
        <div className="flex flex-wrap gap-1.5">
          {STOP_PRESETS.map(p => (
            <SegButton
              key={p}
              active={form.stopMode === 'pct' && form.stopPreset === p}
              onClick={() => { set('stopMode', 'pct'); set('stopPreset', p); }}
            >
              {p}%
            </SegButton>
          ))}
          <SegButton active={form.stopMode === 'pct' && form.stopPreset === 'custom'} onClick={() => { set('stopMode', 'pct'); set('stopPreset', 'custom'); }}>직접 %</SegButton>
          <SegButton active={form.stopMode === 'price'} onClick={() => set('stopMode', 'price')}>손절가 직접</SegButton>
        </div>
        {form.stopMode === 'pct' && form.stopPreset === 'custom' && (
          <input
            type="number" min="0" max="99" step="0.1" value={form.stopPctCustom}
            onChange={(e) => set('stopPctCustom', e.target.value)}
            className={`${inputClasses} mt-1.5`}
          />
        )}
        {form.stopMode === 'price' && (
          <input
            type="number" min="0" step="any" value={form.stopPriceCustom}
            onChange={(e) => set('stopPriceCustom', e.target.value)}
            placeholder="손절가"
            className={`${inputClasses} mt-1.5`}
          />
        )}
        <FieldHint>
          {form.stopMode === 'pct'
            ? `손절폭 ${stopPctVal}% = 기준가 ${anchorPrice > 0 ? formatPlanPrice(anchorPrice, currency) : '?'}에 샀으면 ${result.ok ? formatPlanPrice(result.plan.stopPrice, currency) : '?'}에서 전부 판다.`
            : '손절가를 직접 정합니다 — 이 가격에 닿으면 전량 매도입니다.'}
        </FieldHint>
      </div>

      {/* 익절배수 — Segmented는 null을 값으로 못 받으므로 '없음'을 -1 sentinel로 표현하고 onChange에서 되돌린다 */}
      <div>
        <div className={labelClasses}>익절배수</div>
        <Segmented<number>
          options={[
            ...PROFIT_MULTIPLES.map(m => ({ value: m as number, label: `${m}배` })),
            { value: -1, label: '없음' },
          ]}
          value={form.profitMultiple ?? -1}
          onChange={(v) => set('profitMultiple', v === -1 ? null : (v as 2 | 3 | 4))}
        />
        <FieldHint>
          {form.profitMultiple === null
            ? '익절 없음 — 절반매도 없이 추세선 이탈 시 전량 매도만 합니다.'
            : `익절 ${form.profitMultiple}배 = 손절폭의 ${form.profitMultiple}배(+${(stopPctVal * form.profitMultiple).toFixed(1)}%)에서 절반만 판다.`}
        </FieldHint>
      </div>

      {/* 추세선 */}
      <div>
        <div className={labelClasses}>추세선 (마지막 매도선)</div>
        <div className="flex flex-wrap gap-1.5">
          {EXIT_PERIODS.map(p => (
            <SegButton key={p} active={form.exitLineKind === 'ma' && form.exitLinePeriod === p} onClick={() => { set('exitLineKind', 'ma'); set('exitLinePeriod', p); }}>
              {p}일선
            </SegButton>
          ))}
          <SegButton active={form.exitLineKind === 'price'} onClick={() => set('exitLineKind', 'price')}>직접가</SegButton>
        </div>
        {form.exitLineKind === 'price' && (
          <input
            type="number" min="0" step="any" value={form.exitLinePriceCustom}
            onChange={(e) => set('exitLinePriceCustom', e.target.value)}
            placeholder="추세선 가격"
            className={`${inputClasses} mt-1.5`}
          />
        )}
        {form.exitLineKind === 'ma' && form.exitLinePeriod === 50 && (
          <FieldHint>50일선은 20일선보다 매매 횟수가 적고, 검증에서 성과가 대체로 더 나았습니다.</FieldHint>
        )}
        <FieldHint>
          {form.exitLineKind === 'ma'
            ? `추세선 = ${form.exitLinePeriod}일 평균가. 매일 조금씩 바뀌고, 종가가 이 선 아래로 내려오면 나머지를 판다.`
            : '추세선을 고정 가격으로 직접 정합니다.'}
        </FieldHint>
      </div>

      {/* 불타기 */}
      <div>
        <div className={labelClasses}>불타기</div>
        <div className="flex flex-wrap gap-1.5">
          <SegButton active={!form.pyramidEnabled} onClick={() => set('pyramidEnabled', false)}>안 함</SegButton>
          <SegButton active={form.pyramidEnabled} onClick={() => set('pyramidEnabled', true)}>함</SegButton>
        </div>
        <FieldHint>불타기 = 오를 때만 추가로 사는 것. 내려갈 때 사는 물타기는 이 앱에서 할 수 없다(검증되지 않은 기능 — 기본 꺼짐).</FieldHint>
        {form.pyramidEnabled && (
          <div className="mt-2 space-y-2 bg-gray-900/40 rounded-md p-2.5">
            <div>
              <div className="text-[11px] text-gray-400 mb-1">간격 단위</div>
              <Segmented<PyramidStepUnit>
                options={[
                  { value: 'pct', label: '%(기준가 대비)' },
                  { value: 'r', label: 'R(손절폭 배수)' },
                ]}
                value={form.pyramidStepUnit}
                onChange={(v) => set('pyramidStepUnit', v)}
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">간격 값 ({form.pyramidStepUnit === 'pct' ? '%' : 'R'})</label>
              <input
                type="number" min="0" step="any" value={form.pyramidStep}
                onChange={(e) => set('pyramidStep', e.target.value)}
                className={inputClasses}
              />
            </div>
            <div>
              <div className="text-[11px] text-gray-400 mb-1">투입 크기</div>
              <Segmented<PyramidSizing>
                options={[
                  { value: 'same', label: '같은 금액' },
                  { value: 'half', label: '절반씩' },
                ]}
                value={form.pyramidSizing}
                onChange={(v) => set('pyramidSizing', v)}
              />
            </div>
            <div>
              <div className="text-[11px] text-gray-400 mb-1">최대 단계</div>
              <Segmented<PyramidLevel>
                options={[1, 2, 3].map(n => ({ value: n as PyramidLevel, label: `${n}차` }))}
                value={form.pyramidMaxAdds}
                onChange={(v) => set('pyramidMaxAdds', v)}
              />
            </div>
          </div>
        )}
      </div>

      {/* 증권사 손절주문 등록 */}
      <label className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer">
        <input
          type="checkbox" checked={form.brokerStopOrderRegistered}
          onChange={(e) => set('brokerStopOrderRegistered', e.target.checked)}
          className="mt-0.5 cursor-pointer"
        />
        <span>증권사에 손절 예약주문을 등록했습니다.</span>
      </label>

      {/* 계획 보기 */}
      <button
        type="button"
        onClick={() => setShowPreview(v => !v)}
        className="w-full text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-md transition-colors"
      >
        {showPreview ? '계획 보기 접기 ▲' : '계획 보기 ▼'}
      </button>

      {!result.ok && (
        <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
          {TRADE_PLAN_BUILD_ERROR_LABELS[result.reason]}
        </div>
      )}

      {showPreview && result.ok && (
        <div className="bg-gray-900 rounded-md p-3.5 space-y-2.5 text-xs">
          <div>
            <div className="text-gray-500 mb-0.5">① 매수 정보</div>
            <div className="text-gray-200 space-y-0.5">
              <div>수량 {result.preview.quantity.toLocaleString('en-US')}{isCrypto ? '' : '주'}</div>
              {result.preview.investmentKRW !== null && <div>투자금액 {fmtKRW(result.preview.investmentKRW)}</div>}
              {result.preview.worstLossKRW !== null && result.preview.worstLossPct !== null ? (
                <div className={result.preview.exceedsRiskBudget ? 'text-amber-400' : ''}>
                  최악 손실 {fmtKRW(result.preview.worstLossKRW)} (총자산 {result.preview.worstLossPct.toFixed(2)}%)
                  {result.preview.exceedsRiskBudget && ' — 허용손실 초과'}
                </div>
              ) : (
                <div className="text-gray-500">환율 없음 — 원화 환산 불가</div>
              )}
              {result.preview.adverseLossKRW !== null && (
                <div className="text-gray-500">갭 하락(−{PLAN_ADVERSE_GAP_PCT}%) 시 최대 {fmtKRW(result.preview.adverseLossKRW)}</div>
              )}
              {result.preview.capped && <div className="text-amber-400">손절폭이 좁아 총자산 한도로 제한되었습니다.</div>}
            </div>
          </div>
          <div>
            <div className="text-gray-500 mb-0.5">② 손절선</div>
            <div className="text-red-300">{formatPlanPrice(result.plan.stopPrice, currency)} (−{result.plan.stopPct.toFixed(1)}%) → 전량 매도</div>
          </div>
          <div>
            <div className="text-gray-500 mb-0.5">③ 익절선 (1차, 절반 매도)</div>
            {result.plan.takeProfitPrice !== null ? (
              <div className="text-emerald-300">{formatPlanPrice(result.plan.takeProfitPrice, currency)}</div>
            ) : (
              <div className="text-gray-500">없음</div>
            )}
          </div>
          <div>
            <div className="text-gray-500 mb-0.5">④ 나머지 매도 — 추세선</div>
            {currentExitLineValue !== null ? (
              <div className="text-amber-300 space-y-0.5">
                <div>오늘 값 {formatPlanPrice(currentExitLineValue, currency)}</div>
                {anchorPrice > 0 && anchorPrice < currentExitLineValue && (
                  <div className="text-[11px] text-amber-400">
                    ⚠ 지금 이미 이 선 아래입니다 — 종가가 선 위로 올라온(재돌파) 뒤부터 적용됩니다.
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-500">현재 값 확인 불가(데이터 부족) — 저장은 가능하며, 이후 시세로 판정합니다.</div>
            )}
          </div>
          <p className="text-[11px] text-gray-500 pt-1 border-t border-gray-800">
            근거: 백테스트에서 이 규칙은 큰 하락을 절반 이하로 줄였지만 수익률은 그냥 들고 있는 것보다 낮았습니다.
          </p>
          <p className="text-[11px] text-gray-500">
            주식 수는 소수점 버림 · 세금·수수료·호가 단위 미포함 · 투자자문 아님
          </p>
        </div>
      )}

      {!embedded && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="text-sm text-gray-300 hover:text-white px-4 py-2 rounded-md transition-colors">취소</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!result.ok}
            className="text-sm font-medium text-white bg-primary hover:bg-primary-dark px-4 py-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            저장
          </button>
        </div>
      )}
    </div>
  );
});

export default TradePlanEditor;
