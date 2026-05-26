import React, { useEffect, useRef, useState } from 'react';
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
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
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
        type="button"
      >
        ⋮⋮
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
  className?: string;
}

const ColumnSettingsDropdown: React.FC<ColumnSettingsDropdownProps> = ({ className }) => {
  const { ui, actions } = usePortfolio();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useOnClickOutside(wrapperRef, () => setOpen(false), open);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
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
  };

  const handleReset = () => {
    actions.resetColumnConfig();
  };

  // 정렬키가 숨겨진 컬럼이 되었을 때 알리는 용도는 PortfolioTable이 처리
  useEffect(() => { /* placeholder for keyboard binding */ }, []);

  return (
    <div className={`relative ${className ?? ''}`} ref={wrapperRef}>
      <button
        onClick={() => setOpen(!open)}
        className="hidden md:flex items-center gap-1.5 py-2 px-2.5 rounded-md text-xs font-medium transition bg-gray-700 text-gray-300 hover:bg-gray-600"
        title="컬럼 표시 / 순서 설정"
        type="button"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
        </svg>
        <span className="whitespace-nowrap">컬럼</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-30 py-2">
          <div className="px-3 py-1.5 text-[10px] text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-700 mb-1">
            컬럼 설정
          </div>
          <div className="px-2 py-1 text-[11px] text-gray-500 flex items-center gap-2">
            <span>🔒</span><span className="text-gray-400">종목명</span>
            <span className="ml-auto text-gray-600">고정</span>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ui.columnConfig.map(c => c.key)} strategy={verticalListSortingStrategy}>
              {ui.columnConfig.map(c => (
                <SortableRow key={c.key} config={c} onToggleVisible={handleToggleVisible} />
              ))}
            </SortableContext>
          </DndContext>
          <div className="px-2 py-1 text-[11px] text-gray-500 flex items-center gap-2 mt-1">
            <span>🔒</span><span className="text-gray-400">관리</span>
            <span className="ml-auto text-gray-600">고정</span>
          </div>
          <div className="border-t border-gray-700 mt-2 pt-2 px-2">
            <button
              onClick={handleReset}
              className="w-full text-left px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-white transition rounded flex items-center gap-2"
              type="button"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              기본값으로 초기화
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ColumnSettingsDropdown;
