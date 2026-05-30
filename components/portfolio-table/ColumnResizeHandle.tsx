import React, { useCallback } from 'react';
import { useColumnResize } from '../../hooks/useColumnResize';

interface Props {
  columnKey: string;
  onResize: (width: number) => void;
  onDragPreview: (width: number | null) => void;
}

const ColumnResizeHandle: React.FC<Props> = ({ columnKey, onResize, onDragPreview }) => {
  const { startResize, isResizing } = useColumnResize({ onResize, onDragPreview });

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const th = e.currentTarget.parentElement as HTMLElement | null;
    const startWidth = th?.getBoundingClientRect().width ?? 100;
    startResize(e.clientX, startWidth);
  }, [startResize]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      role="separator"
      aria-label={`${columnKey} 컬럼 크기 조절`}
      className={`absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none transition-colors ${
        isResizing ? 'bg-primary' : 'hover:bg-primary/60'
      }`}
      style={{ touchAction: 'none' }}
    />
  );
};

export default ColumnResizeHandle;
