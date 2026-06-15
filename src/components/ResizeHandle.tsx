/**
 * A draggable divider between resizable panes.
 * Mimics the native macOS NSSplitView divider appearance and behavior.
 *
 * Direction:
 *  - "horizontal" (default): vertical line between left/right columns; cursor: col-resize
 *  - "vertical": horizontal line between top/bottom rows; cursor: row-resize
 */
export default function ResizeHandle({
  onMouseDown,
  direction = "horizontal",
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  direction?: "horizontal" | "vertical";
}) {
  if (direction === "vertical") {
    return (
      <div
        className="h-[5px] shrink-0 cursor-row-resize relative group"
        onMouseDown={onMouseDown}
      >
        {/* Subtle hover indicator */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-transparent group-hover:bg-primary/30 transition-colors" />
      </div>
    );
  }
  return (
    <div
      className="w-[5px] shrink-0 cursor-col-resize"
      onMouseDown={onMouseDown}
    />
  );
}
