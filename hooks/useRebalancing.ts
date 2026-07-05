import { useState, useEffect, useMemo } from 'react';
import { Asset, ExchangeRates, AllocationTargets, RebalanceInstrument } from '../types';
import { getCategoryName, type CategoryDefinition } from '../types/category';
import { buildAllocationTargetsSave, isAllocationDirty } from '../utils/allocationTargets';
import { getAssetBucket, getBucketLabel, BUCKET_LABELS } from '../types/bucket';
import {
  sumByBucket,
  sumCategoryValuesForBucket,
  buildRebalanceRows,
  sumRows,
  assetValueKRW,
  type RebalanceRow,
} from '../utils/bucketRebalancing';
import { computeCoreBands, DEFAULT_REBALANCE_BAND_PCT } from '../utils/rebalanceBands';

interface UseRebalancingProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
  allocationTargets: AllocationTargets;
  onSave: (targets: AllocationTargets) => void;
  categories: CategoryDefinition[];
}

/** 코어 카테고리 행 — RebalanceRow에 state lookup용 categoryKey/표시명을 매핑 (기존 호환) */
export interface CategoryData extends RebalanceRow {
  categoryKey: string; // = key (categoryId 문자열)
  category: string;    // = label (표시명)
}

/** 투더문(위성) 보유 종목 참고 행 */
export interface SatelliteHoldingRow {
  id: string;
  name: string;
  categoryName: string;
  value: number;        // KRW 평가액
  weight: number;       // 위성 내부 비중(%)
}

const BUCKET_KEYS = ['CORE', 'SATELLITE'];

export const useRebalancing = ({ assets, exchangeRates, allocationTargets, onSave, categories }: UseRebalancingProps) => {
  // --- 1. 현재 평가액: 버킷별 / 코어 카테고리별 ---
  const buckets = useMemo(() => sumByBucket(assets, exchangeRates), [assets, exchangeRates]);
  const coreCategoryValues = useMemo(
    () => sumCategoryValuesForBucket(assets, exchangeRates, 'CORE'),
    [assets, exchangeRates],
  );
  const totalCurrentValue = buckets.total;

  // --- 2. State ---
  const [targetTotalAmount, setTargetTotalAmount] = useState<number>(0);
  const [bucketTargetWeights, setBucketTargetWeights] = useState<Record<string, number>>({});
  const [categoryTargetWeights, setCategoryTargetWeights] = useState<Record<string, number>>({});
  // 대표 매수 종목 매핑 (Phase 4b-1) — 저장본으로 초기화, 저장 시 spread 보존
  const [categoryInstruments, setCategoryInstruments] = useState<Record<string, RebalanceInstrument>>(
    () => allocationTargets.categoryInstruments ?? {},
  );
  const [isSaved, setIsSaved] = useState(false);

  // 목표 총 자산액 초기화
  useEffect(() => {
    if (targetTotalAmount === 0) {
      if (allocationTargets.targetTotalAmount && allocationTargets.targetTotalAmount > 0) {
        setTargetTotalAmount(allocationTargets.targetTotalAmount);
      } else if (totalCurrentValue > 0) {
        setTargetTotalAmount(totalCurrentValue);
      }
    }
  }, [totalCurrentValue, targetTotalAmount, allocationTargets]);

  // 버킷 목표비중 초기화: 저장본 우선 → 없으면 현재 버킷 비중. 데이터/저장본이 아직 없으면 대기
  // (빈 상태에서 기본값을 미리 박으면 Drive 로드가 도착해도 가드에 막혀 저장본이 무시됨)
  useEffect(() => {
    if (Object.keys(bucketTargetWeights).length > 0) return;
    if (allocationTargets.bucketWeights && Object.keys(allocationTargets.bucketWeights).length > 0) {
      setBucketTargetWeights(allocationTargets.bucketWeights);
    } else if (totalCurrentValue > 0) {
      setBucketTargetWeights({
        CORE: (buckets.CORE / totalCurrentValue) * 100,
        SATELLITE: (buckets.SATELLITE / totalCurrentValue) * 100,
      });
    }
  }, [allocationTargets, buckets, totalCurrentValue, bucketTargetWeights]);

  // 코어 카테고리 목표비중 초기화: 저장본 → 현재 코어 카테고리 비중(코어 합계 기준)
  useEffect(() => {
    if (Object.keys(categoryTargetWeights).length > 0) return;
    if (allocationTargets.weights && Object.keys(allocationTargets.weights).length > 0) {
      setCategoryTargetWeights(allocationTargets.weights);
    } else if (buckets.CORE > 0) {
      const initial: Record<string, number> = {};
      Object.keys(coreCategoryValues).forEach(key => {
        initial[key] = (coreCategoryValues[key] / buckets.CORE) * 100;
      });
      setCategoryTargetWeights(initial);
    }
  }, [allocationTargets, coreCategoryValues, buckets, categoryTargetWeights]);

  // 대표 종목 매핑 초기화: 저장본 도착 시 채택(로컬 미편집일 때만 — weights와 동일 패턴)
  useEffect(() => {
    if (Object.keys(categoryInstruments).length > 0) return;
    if (allocationTargets.categoryInstruments && Object.keys(allocationTargets.categoryInstruments).length > 0) {
      setCategoryInstruments(allocationTargets.categoryInstruments);
    }
  }, [allocationTargets, categoryInstruments]);

  // --- 3. ① 버킷 tier (코어 vs 투더문, 전체 자산 기준) ---
  const bucketRows = useMemo<RebalanceRow[]>(
    () =>
      buildRebalanceRows({
        keys: BUCKET_KEYS,
        valuesByKey: { CORE: buckets.CORE, SATELLITE: buckets.SATELLITE },
        targetWeights: bucketTargetWeights,
        denominatorValue: totalCurrentValue,
        targetTotalAmount,
        labelOf: key => getBucketLabel(key as 'CORE' | 'SATELLITE'),
      }),
    [buckets, bucketTargetWeights, totalCurrentValue, targetTotalAmount],
  );
  const bucketTotals = useMemo(() => sumRows(bucketRows), [bucketRows]);

  // 코어 목표 금액 = 목표 총액 × 코어 목표비중
  const coreTargetAmount = useMemo(
    () => (targetTotalAmount * (bucketTargetWeights.CORE || 0)) / 100,
    [targetTotalAmount, bucketTargetWeights],
  );

  // --- 4. ② 코어 카테고리 tier (코어 버킷 내부, 코어 합계 기준) ---
  const coreTableData = useMemo<CategoryData[]>(() => {
    const keys = Array.from(new Set([
      ...Object.keys(coreCategoryValues),
      ...Object.keys(categoryTargetWeights),
    ]));
    const rows = buildRebalanceRows({
      keys,
      valuesByKey: coreCategoryValues,
      targetWeights: categoryTargetWeights,
      denominatorValue: buckets.CORE,
      targetTotalAmount: coreTargetAmount,
      labelOf: key => getCategoryName(Number(key), categories),
    });
    return rows
      .map(r => ({ ...r, categoryKey: r.key, category: r.label }))
      .sort((a, b) => b.currentValue - a.currentValue);
  }, [coreCategoryValues, categoryTargetWeights, buckets, coreTargetAmount, categories]);
  const coreTotals = useMemo(() => sumRows(coreTableData), [coreTableData]);

  // 코어 카테고리 밴드 이탈 판정 (Phase 4a 표시 — 편집 state 주입). 생성(4b-3b)은 저장본 주입, 같은 computeCoreBands 경로 공유.
  const bandDeviations = useMemo(
    () => computeCoreBands({
      assets, rates: exchangeRates, categories,
      weights: categoryTargetWeights, bucketWeights: bucketTargetWeights, targetTotalAmount,
    }),
    [assets, exchangeRates, categories, categoryTargetWeights, bucketTargetWeights, targetTotalAmount],
  );

  // 미저장 변경 여부 (Phase 4b-3a) — 편집 state ≠ 저장본. 4b-3b 생성 버튼 게이트("저장 후 생성")용.
  const hasUnsavedChanges = useMemo(
    () => isAllocationDirty(
      { weights: categoryTargetWeights, bucketWeights: bucketTargetWeights, targetTotalAmount, categoryInstruments },
      allocationTargets,
    ),
    [categoryTargetWeights, bucketTargetWeights, targetTotalAmount, categoryInstruments, allocationTargets],
  );

  // --- 5. 투더문 보유 종목 참고 ---
  const satelliteHoldings = useMemo<SatelliteHoldingRow[]>(() => {
    return assets
      .filter(a => getAssetBucket(a) === 'SATELLITE')
      .map(a => {
        const value = assetValueKRW(a, exchangeRates);
        return {
          id: a.id,
          name: a.customName?.trim() || a.name,
          categoryName: getCategoryName(a.categoryId, categories),
          value,
          weight: buckets.SATELLITE > 0 ? (value / buckets.SATELLITE) * 100 : 0,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [assets, exchangeRates, buckets, categories]);

  const hasSatellite = buckets.SATELLITE > 0 || satelliteHoldings.length > 0;

  // --- Handlers ---
  const handleBucketWeightChange = (bucketKey: string, value: string) => {
    const numVal = parseFloat(value);
    setBucketTargetWeights(prev => ({ ...prev, [bucketKey]: isNaN(numVal) ? 0 : numVal }));
    setIsSaved(false);
  };

  const handleCategoryWeightChange = (categoryKey: string, value: string) => {
    const numVal = parseFloat(value);
    setCategoryTargetWeights(prev => ({ ...prev, [categoryKey]: isNaN(numVal) ? 0 : numVal }));
    setIsSaved(false);
  };

  const handleTotalAmountChange = (value: string) => {
    const rawValue = value.replace(/,/g, '');
    const numVal = parseFloat(rawValue);
    setTargetTotalAmount(isNaN(numVal) ? 0 : numVal);
    setIsSaved(false);
  };

  // 대표 종목 지정/변경(instrument)/삭제(null). categoryKey=categoryId 문자열.
  const handleInstrumentChange = (categoryKey: string, instrument: RebalanceInstrument | null) => {
    setCategoryInstruments(prev => {
      const next = { ...prev };
      if (instrument) next[categoryKey] = instrument;
      else delete next[categoryKey];
      return next;
    });
    setIsSaved(false);
  };

  const handleSave = () => {
    // 기존 allocationTargets를 spread해 부분 갱신 — categoryInstruments 등 유실 방지(4b-1 결함 보정)
    onSave(buildAllocationTargetsSave(allocationTargets, {
      weights: categoryTargetWeights,
      targetTotalAmount,
      bucketWeights: bucketTargetWeights,
      categoryInstruments,
    }));
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  // 코어 보유 종목을 categoryId별로 (매핑 지정 시 datalist·통화/이름 자동 채움용)
  const coreHoldingsByCategory = useMemo<Record<string, { ticker: string; name: string; currency: Asset['currency'] }[]>>(() => {
    const out: Record<string, { ticker: string; name: string; currency: Asset['currency'] }[]> = {};
    assets.forEach(a => {
      if (getAssetBucket(a) !== 'CORE') return;
      const key = String(a.categoryId);
      (out[key] ||= []).push({ ticker: a.ticker, name: a.customName?.trim() || a.name, currency: a.currency });
    });
    return out;
  }, [assets]);

  return {
    targetTotalAmount,
    handleTotalAmountChange,
    handleSave,
    isSaved,
    hasSatellite,
    // ① 버킷 tier
    bucket: {
      rows: bucketRows,
      labels: BUCKET_LABELS,
      totalCurrentValue,
      totalTargetWeight: bucketTotals.totalTargetWeight,
      totalTargetValue: bucketTotals.totalTargetValue,
      totalDifference: bucketTotals.totalDifference,
      handleWeightChange: handleBucketWeightChange,
    },
    // ② 코어 카테고리 tier
    core: {
      rows: coreTableData,
      currentValue: buckets.CORE,
      targetAmount: coreTargetAmount,
      totalTargetWeight: coreTotals.totalTargetWeight,
      totalTargetValue: coreTotals.totalTargetValue,
      totalDifference: coreTotals.totalDifference,
      handleWeightChange: handleCategoryWeightChange,
    },
    // 투더문 참고
    satelliteHoldings,
    satelliteValue: buckets.SATELLITE,
    // 코어 카테고리 밴드 이탈 안내 (Phase 4a — 표시 전용, 주문 아님)
    bandDeviations,
    rebalanceBandPct: DEFAULT_REBALANCE_BAND_PCT,
    // 미저장 변경 여부 (Phase 4b-3a) — 4b-3b 생성 버튼 게이트용
    hasUnsavedChanges,
    // 대표 매수 종목 매핑 (Phase 4b-1) — 저장/수정/삭제, 생성은 4b-2+
    categoryInstruments,
    handleInstrumentChange,
    coreHoldingsByCategory,
  };
};
