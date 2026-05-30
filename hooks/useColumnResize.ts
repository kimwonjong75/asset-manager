import { useCallback, useEffect, useRef, useState } from 'react';
import { MIN_COLUMN_WIDTH } from '../types/ui';

interface UseColumnResizeOptions {
  onResize: (width: number) => void;
  onDragPreview: (width: number | null) => void;
}

interface UseColumnResizeReturn {
  startResize: (clientX: number, startWidth: number) => void;
  isResizing: boolean;
}

export function useColumnResize({ onResize, onDragPreview }: UseColumnResizeOptions): UseColumnResizeReturn {
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const previewRef = useRef<number>(0);
  const onResizeRef = useRef(onResize);
  const onDragPreviewRef = useRef(onDragPreview);

  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);
  useEffect(() => { onDragPreviewRef.current = onDragPreview; }, [onDragPreview]);

  const cleanup = useCallback(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const startResize = useCallback((clientX: number, startWidth: number) => {
    dragRef.current = { startX: clientX, startWidth };
    previewRef.current = startWidth;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = e.clientX - dragRef.current.startX;
      const next = Math.max(MIN_COLUMN_WIDTH, dragRef.current.startWidth + delta);
      previewRef.current = next;
      onDragPreviewRef.current(next);
    };

    const handleUp = () => {
      if (!dragRef.current) return;
      const final = previewRef.current;
      dragRef.current = null;
      setIsResizing(false);
      onDragPreviewRef.current(null);
      onResizeRef.current(final);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      cleanup();
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [cleanup]);

  useEffect(() => {
    return () => {
      if (dragRef.current) {
        cleanup();
      }
    };
  }, [cleanup]);

  return { startResize, isResizing };
}
