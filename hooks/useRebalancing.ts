import { useState, useEffect, useMemo } from 'react';
import { Asset, ExchangeRates, Currency, AllocationTargets } from '../types';
import { getCategoryName, type CategoryDefinition } from '../types/category';

interface UseRebalancingProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
  allocationTargets: AllocationTargets;
  onSave: (targets: AllocationTargets) => void;
  categories: CategoryDefinition[];
}

export interface CategoryData {
  categoryKey: string;   // categoryId as string key (for state lookup)
  category: string;      // display name
  currentValue: number;
  currentWeight: number;
  targetWeight: number;
  targetValue: number;
  difference: number;
}

export const useRebalancing = ({ assets, exchangeRates, allocationTargets, onSave, categories }: UseRebalancingProps) => {
  // --- 1. Calculate Current Values & Weights ---
  const { categoryValues, totalCurrentValue } = useMemo(() => {
    const values: Record<string, number> = {};
    let total = 0;

    assets.forEach((asset) => {
      const rate = asset.currency === Currency.KRW ? 1 : (exchangeRates[asset.currency] || 0);
      const val = asset.currentPrice * asset.quantity * rate;
      values[asset.categoryId] = (values[asset.categoryId] || 0) + val;
      total += val;
    });

    return { categoryValues: values, totalCurrentValue: total };
  }, [assets, exchangeRates]);

  // --- 2. State ---
  const [targetTotalAmount, setTargetTotalAmount] = useState<number>(0);
  const [targetWeights, setTargetWeights] = useState<Record<string, number>>({});
  const [isSaved, setIsSaved] = useState(false);

  // Initialize state (Target Total Amount)
  useEffect(() => {
    if (targetTotalAmount === 0) {
      if (allocationTargets.targetTotalAmount && allocationTargets.targetTotalAmount > 0) {
        setTargetTotalAmount(allocationTargets.targetTotalAmount);
      } else if (totalCurrentValue > 0) {
        setTargetTotalAmount(totalCurrentValue);
      }
    }
  }, [totalCurrentValue, targetTotalAmount, allocationTargets]);

  // Initialize weights from props (allocationTargets) or current weights
  useEffect(() => {
    if (Object.keys(targetWeights).length === 0 && totalCurrentValue > 0) {
        if (allocationTargets.weights && Object.keys(allocationTargets.weights).length > 0) {
            // Use saved targets
            setTargetWeights(allocationTargets.weights);
        } else {
            // Default to current weights
            const initialWeights: Record<string, number> = {};
            Object.keys(categoryValues).forEach(cat => {
                initialWeights[cat] = (categoryValues[cat] / totalCurrentValue) * 100;
            });
            setTargetWeights(initialWeights);
        }
    }
  }, [allocationTargets, categoryValues, totalCurrentValue, targetWeights]);

  // --- 3. Calculate Table Data ---
  const tableData: CategoryData[] = useMemo(() => {
    const categoryKeys = Array.from(new Set([
        ...Object.keys(categoryValues),
        ...Object.keys(targetWeights)
    ]));

    return categoryKeys.map(key => {
        const currentValue = categoryValues[key] || 0;
        const currentWeight = totalCurrentValue > 0 ? (currentValue / totalCurrentValue) * 100 : 0;
        const targetWeight = targetWeights[key] || 0;
        const targetValue = (targetTotalAmount * targetWeight) / 100;
        const difference = targetValue - currentValue;

        return {
            categoryKey: key,
            category: getCategoryName(Number(key), categories),
            currentValue,
            currentWeight,
            targetWeight,
            targetValue,
            difference
        };
    }).sort((a, b) => b.currentValue - a.currentValue);
  }, [categoryValues, totalCurrentValue, targetTotalAmount, targetWeights, categories]);

  // Calculate totals
  const totalTargetWeight = tableData.reduce((sum, item) => sum + item.targetWeight, 0);
  const totalTargetValue = tableData.reduce((sum, item) => sum + item.targetValue, 0);
  const totalDifference = tableData.reduce((sum, item) => sum + item.difference, 0);

  // --- Handlers ---
  const handleWeightChange = (category: string, value: string) => {
    const numVal = parseFloat(value);
    setTargetWeights(prev => ({
        ...prev,
        [category]: isNaN(numVal) ? 0 : numVal
    }));
    setIsSaved(false);
  };

  const handleTotalAmountChange = (value: string) => {
      const rawValue = value.replace(/,/g, '');
      const numVal = parseFloat(rawValue);
      setTargetTotalAmount(isNaN(numVal) ? 0 : numVal);
      setIsSaved(false); // Mark as unsaved when total amount changes
  };

  const handleSave = () => {
      onSave({
        weights: targetWeights,
        targetTotalAmount: targetTotalAmount
      });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
  };

  return {
      tableData,
      totalCurrentValue,
      totalTargetWeight,
      totalTargetValue,
      totalDifference,
      targetTotalAmount,
      handleWeightChange,
      handleTotalAmountChange,
      handleSave,
      isSaved
  };
};
