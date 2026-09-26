// components/settings/TurtleHoldingsSettingsSection.tsx
// ---------------------------------------------------------------------------
// 설정 '터틀 규칙' 섹션 (계획서 PLAN_터틀중심_앱재정비_260925 §4.7·§6 P3, 2026-09-26 승인).
//
// §3.1 표의 모든 항목을 편집한다. 각 항목 옆에 '원조'/'조정' 배지 + 값을 바꿀 때 과거 검증 성적
// 한 줄(utils/turtleVerificationNotes, 골든 고정 문구 — 계산·재작성 없음). 입력 가드는
// resolveHoldingsSettings(utils/turtleHoldings)와 범위가 같다(그 함수가 최종 안전망).
//
// 저장: 로컬 draft state → [저장] 버튼 → actions.saveTurtleHoldingsSettings(단일 커밋 + 성공 메시지,
// UpdateStatusIndicator 관례). 키 입력마다 저장하지 않는다("보이지 않는 쓰기 금지").
// 렌더 전용 + 얇은 draft 상태만 — 계산은 전부 utils/turtleHoldings·utils/turtleVerificationNotes.

import React, { useMemo, useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useTurtleHoldings } from '../../hooks/useTurtleHoldings';
import { resolveHoldingsSettings } from '../../utils/turtleHoldings';
import { shouldPromptDrawdownReferenceRefresh } from '../../utils/turtleHoldingsView';
import {
  DEFAULT_TURTLE_HOLDINGS_SETTINGS, TurtleHoldingsSettings, HoldingsExitMethod, PyramidSpacingMode,
} from '../../types/turtleHoldings';
import {
  exitMethodBadge, pyramidSpacingBadge, turtleFieldBadge, describeExitLookbackWarning,
  collectTurtleVerificationNotes, TurtleFieldBadge,
} from '../../utils/turtleVerificationNotes';
import { formatKRW } from '../portfolio-table/utils';
import Badge from '../common/Badge';
import { localDateString } from '../../utils/localDate';
import { Check } from 'lucide-react';

const FieldBadge: React.FC<{ badge: TurtleFieldBadge }> = ({ badge }) => (
  <Badge tone={badge === '원조' ? 'neutral' : 'info'} size="sm">{badge}</Badge>
);

const NoteText: React.FC<{ text: string }> = ({ text }) => (
  <p className="mt-1 text-xs text-gray-500 leading-relaxed">{text}</p>
);

const FieldRow: React.FC<{ label: string; badge?: TurtleFieldBadge; children: React.ReactNode; note?: string }> = ({ label, badge, children, note }) => (
  <div className="py-2.5 border-b border-gray-800 last:border-b-0">
    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
      <span className="text-sm text-gray-200 font-medium">{label}</span>
      {badge && <FieldBadge badge={badge} />}
    </div>
    {children}
    {note && <NoteText text={note} />}
  </div>
);

const numInput = 'w-28 text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-1.5 text-gray-100 focus:outline-none focus:border-primary';
const segBtn = (active: boolean) =>
  `text-xs px-2.5 py-1.5 rounded-md transition-colors ${active ? 'bg-primary text-white font-semibold' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`;

const TurtleHoldingsSettingsSection: React.FC = () => {
  const { data, actions } = usePortfolio();
  const model = useTurtleHoldings(); // 읽기 전용 — [지금 자산으로 기준 정하기] 버튼용 현재 관리자산만 참조.
  const saved = useMemo(() => resolveHoldingsSettings(data.turtleSettings.holdings), [data.turtleSettings.holdings]);

  const [draft, setDraft] = useState<TurtleHoldingsSettings>(saved);
  // 외부에서 저장본이 바뀌면(Drive 로드·이 섹션의 저장 자체) draft를 동기화한다. 렌더 중 상태 조정
  // 패턴(React 권장 — "Adjusting state when a prop changes")으로 처리해 effect의 cascading render를
  // 피한다(react-hooks/set-state-in-effect). `saved`는 useMemo로 안정된 참조이므로 자기 저장 직후에만
  // 바뀐다 — 사용자가 타이핑 중인 값을 덮어쓸 위험은 낮다.
  const [syncedSaved, setSyncedSaved] = useState<TurtleHoldingsSettings>(saved);
  if (saved !== syncedSaved) {
    setSyncedSaved(saved);
    setDraft(saved);
  }
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const notes = useMemo(() => collectTurtleVerificationNotes(draft), [draft]);
  const exitWarning = draft.exitMethod === 'donchian' ? describeExitLookbackWarning(draft.exitLookback) : null;

  const patch = (p: Partial<TurtleHoldingsSettings>) => { setDraft(prev => ({ ...prev, ...p })); setJustSaved(false); };

  const handleSave = () => {
    actions.saveTurtleHoldingsSettings(draft);
    setJustSaved(true);
  };

  const handleResetToDefault = () => {
    // 계좌 축소 기준 자산(사용자의 개인 계좌 스냅샷)은 "규칙 되돌리기"의 대상이 아니므로 보존한다.
    setDraft({
      ...DEFAULT_TURTLE_HOLDINGS_SETTINGS,
      drawdownReferenceKRW: draft.drawdownReferenceKRW,
      drawdownReferenceSetAt: draft.drawdownReferenceSetAt,
    });
    setJustSaved(false);
  };

  const setReferenceToNow = () => {
    patch({ drawdownReferenceKRW: Math.round(model.managedEquityKRW), drawdownReferenceSetAt: localDateString() });
  };

  const refreshPrompt = shouldPromptDrawdownReferenceRefresh(saved.drawdownReferenceSetAt, new Date());

  const categories = data.categoryStore.categories;
  const heldAssets = useMemo(
    () => data.assets.filter(a => a.quantity > 0).slice().sort((a, b) => (a.customName?.trim() || a.name).localeCompare(b.customName?.trim() || b.name, 'ko')),
    [data.assets],
  );
  const toggleExcludedAsset = (id: string) => {
    const set = new Set(draft.excludedAssetIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    patch({ excludedAssetIds: [...set] });
  };
  const toggleExcludedCategory = (id: number) => {
    const set = new Set(draft.excludedCategoryIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    patch({ excludedCategoryIds: [...set] });
  };

  return (
    <div className="bg-gray-800 rounded-lg">
      <div className="px-6 py-5 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">터틀 규칙</h2>
        <p className="text-gray-400 text-sm mt-1 leading-relaxed">
          보유종목 터틀이 매일 계산하는 선(청산·재진입·손절·불타기)의 기준값입니다. 값을 바꾸면 과거 검증 성적을
          함께 보여줍니다 — 투자자문이 아니며, 과거 데이터 기준입니다.
        </p>
      </div>

      <div className="px-6 py-4">
        {/* 진입(재진입) */}
        <FieldRow label="다시 살 때(재진입) — 직전 N일 최고가" badge={turtleFieldBadge('entryLookback', draft.entryLookback)}>
          <input
            type="number" min={20} max={100} step={1} value={draft.entryLookback}
            onChange={e => patch({ entryLookback: Math.round(Number(e.target.value) || 0) })}
            className={numInput}
          />
          <span className="ml-2 text-xs text-gray-500">일 (20~100)</span>
        </FieldRow>

        {/* 청산 방식 */}
        <FieldRow
          label="팔 때(청산) 방식"
          badge={exitMethodBadge(draft.exitMethod, draft.exitLookback)}
          note={notes.exit}
        >
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(['donchian', 'ma', 'atrTrail'] as HoldingsExitMethod[]).map(m => (
              <button key={m} type="button" className={segBtn(draft.exitMethod === m)} onClick={() => patch({ exitMethod: m })}>
                {m === 'donchian' ? '최저가 채널' : m === 'ma' ? '이동평균' : 'ATR 추적선'}
              </button>
            ))}
          </div>
          {draft.exitMethod === 'donchian' && (
            <div>
              <input
                type="number" min={10} max={55} step={1} value={draft.exitLookback}
                onChange={e => patch({ exitLookback: Math.round(Number(e.target.value) || 0) })}
                className={numInput}
              />
              <span className="ml-2 text-xs text-gray-500">일 최저가 (10~55)</span>
              {exitWarning && <p className="mt-1 text-xs text-warning">{exitWarning}</p>}
            </div>
          )}
          {draft.exitMethod === 'ma' && (
            <div>
              <input
                type="number" min={5} max={200} step={1} value={draft.maPeriod}
                onChange={e => patch({ maPeriod: Math.round(Number(e.target.value) || 0) })}
                className={numInput}
              />
              <span className="ml-2 text-xs text-gray-500">일 이동평균</span>
            </div>
          )}
          {draft.exitMethod === 'atrTrail' && (
            <div>
              <input
                type="number" min={1.5} max={5} step={0.5} value={draft.atrTrailMultiple}
                onChange={e => patch({ atrTrailMultiple: Number(e.target.value) || 0 })}
                className={numInput}
              />
              <span className="ml-2 text-xs text-gray-500">배(ATR20 기준)</span>
            </div>
          )}
        </FieldRow>

        {/* 손절 배수 */}
        <FieldRow label="손절 배수 (재매수분, 2N)" badge={turtleFieldBadge('stopMultipleN', draft.stopMultipleN)}>
          <input
            type="number" min={1.5} max={3} step={0.1} value={draft.stopMultipleN}
            onChange={e => patch({ stopMultipleN: Number(e.target.value) || 0 })}
            className={numInput}
          />
          <span className="ml-2 text-xs text-gray-500">×N (1.5~3)</span>
        </FieldRow>

        {/* 유닛 위험 % */}
        <FieldRow label="유닛당 위험 %(관리자산 대비)" badge={turtleFieldBadge('riskPerUnitPct', draft.riskPerUnitPct)}>
          <input
            type="number" min={0.25} max={1} step={0.05} value={draft.riskPerUnitPct}
            onChange={e => patch({ riskPerUnitPct: Number(e.target.value) || 0 })}
            className={numInput}
          />
          <span className="ml-2 text-xs text-gray-500">% (0.25~1)</span>
        </FieldRow>

        {/* 최대 유닛 */}
        <FieldRow label="종목당 최대 유닛" badge={turtleFieldBadge('maxUnitsPerPosition', draft.maxUnitsPerPosition)}>
          <input
            type="number" min={1} max={4} step={1} value={draft.maxUnitsPerPosition}
            onChange={e => patch({ maxUnitsPerPosition: Math.round(Number(e.target.value) || 0) })}
            className={numInput}
          />
          <span className="ml-2 text-xs text-gray-500">유닛 (1~4)</span>
        </FieldRow>

        {/* 불타기 간격 */}
        <FieldRow label="불타기 간격" badge={pyramidSpacingBadge(draft.pyramidSpacing)} note={notes.pyramid}>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(['2R', 'halfN', 'custom'] as PyramidSpacingMode[]).map(m => (
              <button key={m} type="button" className={segBtn(draft.pyramidSpacing === m)} onClick={() => patch({ pyramidSpacing: m })}>
                {m === '2R' ? '2R(강의식 기본)' : m === 'halfN' ? '½N(원조)' : '직접 입력'}
              </button>
            ))}
          </div>
          {draft.pyramidSpacing === 'custom' && (
            <div>
              <input
                type="number" min={0.1} max={10} step={0.1} value={draft.pyramidCustomN}
                onChange={e => patch({ pyramidCustomN: Number(e.target.value) || 0 })}
                className={numInput}
              />
              <span className="ml-2 text-xs text-gray-500">×N 오를 때마다 추가</span>
            </div>
          )}
        </FieldRow>

        {/* 불타기 추가 금액 배수 */}
        <FieldRow label="추가 매수(불타기) 금액" badge={turtleFieldBadge('pyramidSizeMultiplier', draft.pyramidSizeMultiplier)}>
          <div className="flex flex-wrap gap-1.5">
            {[1, 0.5].map(m => (
              <button key={m} type="button" className={segBtn(draft.pyramidSizeMultiplier === m)} onClick={() => patch({ pyramidSizeMultiplier: m as 1 | 0.5 })}>
                최초 유닛의 {m}배
              </button>
            ))}
          </div>
        </FieldRow>

        {/* 종목 한도 */}
        <FieldRow label="종목당 한도(관리자산 대비, 4유닛 기준)" badge={turtleFieldBadge('positionCapPct', draft.positionCapPct)} note={notes.cap}>
          <input
            type="number" min={5} max={25} step={1} value={draft.positionCapPct}
            onChange={e => patch({ positionCapPct: Math.round(Number(e.target.value) || 0) })}
            className={numInput}
          />
          <span className="ml-2 text-xs text-gray-500">% (5~25, 권장 5~15)</span>
        </FieldRow>

        {/* 전체 위험 한도 */}
        <FieldRow label="전체 위험 한도" badge={turtleFieldBadge('maxTotalRiskPct', draft.maxTotalRiskPct)} note={notes.totalRisk}>
          <input
            type="number" min={12} max={24} step={1} value={draft.maxTotalRiskPct}
            onChange={e => patch({ maxTotalRiskPct: Math.round(Number(e.target.value) || 0) })}
            className={numInput}
          />
          <span className="ml-2 text-xs text-gray-500">% (12~24)</span>
        </FieldRow>

        {/* 계좌 축소 */}
        <FieldRow label="계좌 축소(드로다운 감쇄)" badge={turtleFieldBadge('drawdownScalingEnabled', draft.drawdownScalingEnabled)} note={notes.drawdown}>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button" role="switch" aria-checked={draft.drawdownScalingEnabled}
              onClick={() => patch({ drawdownScalingEnabled: !draft.drawdownScalingEnabled })}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${draft.drawdownScalingEnabled ? 'bg-primary' : 'bg-gray-600'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${draft.drawdownScalingEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
            </button>
            <span className="text-xs text-gray-400">
              기준 자산: {draft.drawdownReferenceKRW ? `${formatKRW(draft.drawdownReferenceKRW)} (${draft.drawdownReferenceSetAt})` : '미설정(현재 관리자산을 자기 기준으로 사용 — 감쇄 미적용)'}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button
              type="button" onClick={setReferenceToNow}
              className="text-xs text-gray-200 bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-md transition-colors"
              title="현재 관리자산을 계좌 축소 기준으로 저장합니다(저장 버튼을 눌러야 반영됩니다)"
            >
              지금 관리자산({formatKRW(model.managedEquityKRW)})으로 기준 정하기
            </button>
            {refreshPrompt && (
              <span className="text-xs text-warning">기준 자산을 새로 정하세요 — 1월이거나 정한 지 1년이 넘었습니다.</span>
            )}
          </div>
        </FieldRow>

        {/* 최소 주문 */}
        <FieldRow label="최소 주문 금액" badge={turtleFieldBadge('minOrderKRW', draft.minOrderKRW)}>
          <input
            type="number" min={0} step={10_000} value={draft.minOrderKRW}
            onChange={e => patch({ minOrderKRW: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            className={numInput}
          />
          <span className="ml-2 text-xs text-gray-500">원 미만이면 재매수 생략</span>
        </FieldRow>

        {/* 적용 범위 */}
        <FieldRow label="적용 범위" note={notes.coreExcl}>
          <p className="text-xs text-gray-400 mb-2">가족(유선) 계정은 항상 제외됩니다(고정, 여기서 바꿀 수 없음).</p>

          <div className="mb-3">
            <p className="text-xs text-gray-300 mb-1.5">자산군(카테고리)별 제외</p>
            <div className="flex flex-wrap gap-1.5">
              {categories.map(c => {
                const excluded = draft.excludedCategoryIds.includes(c.id);
                return (
                  <button key={c.id} type="button" className={segBtn(excluded)} onClick={() => toggleExcludedCategory(c.id)}>
                    {excluded && <Check className="inline h-3 w-3 mr-1 align-[-1px]" aria-hidden="true" />}{c.name}
                  </button>
                );
              })}
            </div>
          </div>

          {heldAssets.length > 0 && (
            <div>
              <p className="text-xs text-gray-300 mb-1.5">종목별 제외 (보유 중 {heldAssets.length}종목)</p>
              <div className="max-h-48 overflow-y-auto rounded-md border border-gray-700 divide-y divide-gray-800">
                {heldAssets.map(a => {
                  const excluded = draft.excludedAssetIds.includes(a.id);
                  return (
                    <label key={a.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-900/40 cursor-pointer">
                      <input type="checkbox" checked={excluded} onChange={() => toggleExcludedAsset(a.id)} className="accent-primary" />
                      <span className="truncate">{a.customName?.trim() || a.name}</span>
                      <span className="text-gray-500 shrink-0">{a.ticker}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </FieldRow>
      </div>

      <div className="px-6 py-4 border-t border-gray-700 flex items-center gap-2 flex-wrap">
        <button
          type="button" onClick={handleSave} disabled={!dirty}
          className="text-xs font-medium text-white bg-primary hover:bg-primary-dark px-4 py-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >저장</button>
        <button
          type="button" onClick={handleResetToDefault}
          className="text-xs text-gray-200 bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-md transition-colors"
        >원조 기본값으로 되돌리기</button>
        {justSaved && !dirty && (
          <span className="inline-flex items-center gap-1 text-xs text-ok"><Check className="h-3.5 w-3.5" aria-hidden="true" />저장됨</span>
        )}
      </div>
    </div>
  );
};

export default TurtleHoldingsSettingsSection;
