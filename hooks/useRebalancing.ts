import { useState, useEffect, useMemo } from 'react';
import { Asset, ExchangeRates, AllocationTargets } from '../types';
import { getCategoryName, type CategoryDefinition } from '../types/category';
import { getAssetBucket, getBucketLabel, BUCKET_LABELS } from '../types/bucket';
import {
  sumByBucket,
  sumCategoryValuesForBucket,
  buildRebalanceRows,
  sumRows,
  assetValueKRW,
  type RebalanceRow,
} from '../utils/bucketRebalancing';
import { detectRebalanceBands, DEFAULT_REBALANCE_BAND_PCT } from '../utils/rebalanceBands';

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

  // 코어 카테고리 밴드 이탈 판정 (Phase 4a — 표시 전용). 코어 목표금액 미설정(0)이면 판정 안 함.
  const bandDeviations = useMemo(
    () => (coreTargetAmount > 0
      ? detectRebalanceBands(coreTableData, { targetTotalAmount, coreCurrentValue: buckets.CORE })
      : []),
    [coreTableData, targetTotalAmount, buckets.CORE, coreTargetAmount],
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

  const handleSave = () => {
    onSave({
      weights: categoryTargetWeights,
      targetTotalAmount,
      bucketWeights: bucketTargetWeights,
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

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
  };
};
