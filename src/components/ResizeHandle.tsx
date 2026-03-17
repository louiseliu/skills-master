/**
 * A draggable divider between resizable columns.
 * Mimics the native macOS NSSplitView divider appearance and behavior.
 */
export default function ResizeHandle({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="w-[5px] shrink-0 cursor-col-resize relative group"
      onMouseDown={onMouseDown}
    >
      {/* Hover / active indicator line */}
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:w-[3px] group-hover:bg-primary/30 group-active:w-[3px] group-active:bg-primary/50 transition-all rounded-full" />
    </div>
  );
}
