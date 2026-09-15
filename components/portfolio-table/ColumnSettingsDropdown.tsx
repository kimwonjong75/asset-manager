import React, { useState } from 'react';
import { GripVertical, Lock, RotateCcw } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Popover from '../common/Popover';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { ColumnConfig, ColumnKey, COLUMN_LABELS } from '../../types/ui';

interface SortableRowProps {
  config: ColumnConfig;
  onToggleVisible: (key: ColumnKey, visible: boolean) => void;
}

const SortableRow: React.FC<SortableRowProps> = ({ config, onToggleVisible }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: config.key });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-700 rounded"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300 px-1 select-none"
        title="드래그하여 순서 변경"
        aria-label="드래그하여 순서 변경"
        type="button"
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <label className="flex items-center gap-2 flex-1 cursor-pointer">
        <input
          type="checkbox"
          checked={config.visible}
          onChange={(e) => onToggleVisible(config.key, e.target.checked)}
          className="rounded accent-primary"
        />
        <span className="text-sm text-gray-200">{COLUMN_LABELS[config.key]}</span>
      </label>
    </div>
  );
};

interface ColumnSettingsDropdownProps {
  /** 패널을 붙일 앵커(PortfolioTable '보기' 버튼) */
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  /** 바깥 클릭·Esc·포커스 이탈로 닫힘 — 열림 상태는 호출부가 소유 */
  onClose: () => void;
  /** 컬럼을 숨겼을 때 알림 — 호출부가 그 컬럼이 정렬 기준이면 정렬을 해제한다 */
  onColumnHidden?: (key: ColumnKey) => void;
}

/**
 * 컬럼 표시/순서 설정 패널 (데스크탑 전용). Stage D2: 공용 `Popover`(포털·z-menu) 안에 렌더.
 * dnd-kit 드래그 중에는 `dismissible=false` — KeyboardSensor/PointerSensor 가 Esc 로 드래그를 취소하므로
 * 그 Esc 가 팝오버까지 닫지 않게 한다.
 */
const ColumnSettingsDropdown: React.FC<ColumnSettingsDropdownProps> = ({ anchorRef, open, onClose, onColumnHidden }) => {
  const { ui, actions } = usePortfolio();
  const [dragging, setDragging] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ui.columnConfig.findIndex(c => c.key === active.id);
    const newIndex = ui.columnConfig.findIndex(c => c.key === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(ui.columnConfig, oldIndex, newIndex);
    actions.setColumnConfig(next);
  };

  const handleToggleVisible = (key: ColumnKey, visible: boolean) => {
    const next = ui.columnConfig.map(c => (c.key === key ? { ...c, visible } : c));
    actions.setColumnConfig(next);
    if (!visible) onColumnHidden?.(key);
  };

  const handleReset = () => {
    actions.resetColumnConfig();
  };

  const handleClose = () => {
    setDragging(false);
    onClose();
  };

  return (
    <Popover
      anchorRef={anchorRef}
      open={open}
      onClose={handleClose}
      label="컬럼 설정"
      align="end"
      width={256}
      dismissible={!dragging}
      className="py-2"
    >
      <div className="px-3 py-1.5 text-xs text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-700 mb-1">
        컬럼 설정
      </div>
      <div className="px-2 py-1 text-xs text-gray-500 flex items-center gap-2">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-gray-400">종목명</span>
        <span className="ml-auto text-gray-500">고정</span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setDragging(true)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(false)}
      >
        <SortableContext items={ui.columnConfig.map(c => c.key)} strategy={verticalListSortingStrategy}>
          {ui.columnConfig.map(c => (
            <SortableRow key={c.key} config={c} onToggleVisible={handleToggleVisible} />
          ))}
        </SortableContext>
      </DndContext>
      <div className="px-2 py-1 text-xs text-gray-500 flex items-center gap-2 mt-1">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-gray-400">관리</span>
        <span className="ml-auto text-gray-500">고정</span>
      </div>
      <div className="border-t border-gray-700 mt-2 pt-2 px-2">
        <button
          onClick={handleReset}
          className="w-full text-left px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-white transition rounded flex items-center gap-2"
          type="button"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          기본값으로 초기화
        </button>
      </div>
    </Popover>
  );
};

export default ColumnSettingsDropdown;
