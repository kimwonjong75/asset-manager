import React, { useMemo } from 'react';
import { Asset } from '../../types';
import { getAllowedCategories } from '../../types/category';
import { usePortfolio } from '../../contexts/PortfolioContext';

interface DashboardControlsProps {
    assets: Asset[];
    filterCategory: number | 'ALL' | 'SATELLITE';
    onFilterChange: (category: number | 'ALL' | 'SATELLITE') => void;
}

// 자산 구분 필터 — 홈 '손익 추이' 카드 헤더 안에 인라인으로 들어간다(자체 카드 표면 없음, Stage A).
// 이 필터는 손익 추이 차트에만 적용된다(스냅샷·배분·자산군 요약은 계정 필터만 따름).
// 환율 입력은 MarketOverviewBar(시장 요약 한 줄)로 이전됨 — 여기서는 자산 구분 필터만.
const DashboardControls: React.FC<DashboardControlsProps> = ({
    assets,
    filterCategory,
    onFilterChange,
}) => {
    const { data } = usePortfolio();
    const cats = data.categoryStore.categories;

    const categoryOptions = useMemo(() => {
        const allowed = getAllowedCategories(cats);
        const assetCatIds = new Set(assets.map(a => a.categoryId));
        const allowedIds = new Set(allowed.map(c => c.id));
        const extras = cats.filter(c => assetCatIds.has(c.id) && !allowedIds.has(c.id));
        return [...allowed, ...extras];
    }, [assets, cats]);

    return (
        <div className="flex items-center gap-2" title="손익 추이 차트에 표시할 자산의 종류를 선택합니다.">
            <label htmlFor="dashboard-filter" className="text-xs text-gray-400 whitespace-nowrap">
                자산 구분
            </label>
            <div className="relative">
                <select
                    id="dashboard-filter"
                    value={filterCategory}
                    onChange={(e) => { const v = e.target.value; onFilterChange(v === 'ALL' || v === 'SATELLITE' ? v : Number(v)); }}
                    className="bg-gray-700 border border-gray-600 rounded-md min-h-9 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent appearance-none"
                >
                    <option value="ALL">전체 포트폴리오</option>
                    {categoryOptions.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                    <option value="SATELLITE">🚀 투더문 (위성)</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
            </div>
        </div>
    );
};

export default DashboardControls;
