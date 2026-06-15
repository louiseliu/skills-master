import { useState, useCallback, useRef, useEffect } from "react";

interface UseResizableOptions {
  /** Initial width in pixels */
  initial: number;
  /** Minimum width in pixels */
  min?: number;
  /** Maximum width in pixels */
  max?: number;
  /** Storage key to persist width across sessions */
  storageKey?: string;
}

export function useResizable({
  initial,
  min = 120,
  max = 800,
  storageKey,
}: UseResizableOptions) {
  const [width, setWidth] = useState<number>(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const n = parseInt(saved, 10);
        if (!isNaN(n) && n >= min && n <= max) return n;
      }
    }
    return initial;
  });

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const widthRef = useRef(width);
  widthRef.current = width;

  // Persist width
  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, String(width));
    }
  }, [width, storageKey]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = widthRef.current;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = ev.clientX - startX.current;
        const newWidth = Math.min(max, Math.max(min, startWidth.current + delta));
        setWidth(newWidth);
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [min, max]
  );

  return { width, onMouseDown };
}

/**
 * Vertical version: returns a height (px) and a drag handle that resizes
 * along the Y axis. Dragging down increases height, dragging up decreases it.
 */
export function useResizableY({
  initial,
  min = 120,
  max = 1200,
  storageKey,
}: UseResizableOptions) {
  const [height, setHeight] = useState<number>(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const n = parseInt(saved, 10);
        if (!isNaN(n) && n >= min && n <= max) return n;
      }
    }
    return initial;
  });

  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const heightRef = useRef(height);
  heightRef.current = height;

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, String(height));
    }
  }, [height, storageKey]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startY.current = e.clientY;
      startHeight.current = heightRef.current;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = ev.clientY - startY.current;
        const newHeight = Math.min(max, Math.max(min, startHeight.current + delta));
        setHeight(newHeight);
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [min, max]
  );

  return { height, onMouseDown };
}

/**
 * Same as useResizable but measures delta from the right edge (for right-side panels).
 * Dragging left increases width, dragging right decreases width.
 */
export function useResizableFromRight({
  initial,
  min = 120,
  max = 800,
  storageKey,
}: UseResizableOptions) {
  const [width, setWidth] = useState<number>(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const n = parseInt(saved, 10);
        if (!isNaN(n) && n >= min && n <= max) return n;
      }
    }
    return initial;
  });

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, String(width));
    }
  }, [width, storageKey]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = widthRef.current;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        // Moving left = increasing width
        const delta = startX.current - ev.clientX;
        const newWidth = Math.min(max, Math.max(min, startWidth.current + delta));
        setWidth(newWidth);
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [min, max]
  );

  return { width, onMouseDown };
}
