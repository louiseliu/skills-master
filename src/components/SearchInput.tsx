import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Debounce delay in ms. 0 = no debounce (instant). Default 300. */
  debounce?: number;
  /** Global keyboard shortcut to focus. Default: "k" (Cmd+K / Ctrl+K). */
  shortcutKey?: string;
  /** Optional live count badge shown next to keyboard hint, e.g. {current:3,total:12} */
  count?: { current: number; total: number } | null;
  /** Enable "/" key to focus when nothing else is focused. Default true. */
  enableSlashShortcut?: boolean;
}

/**
 * Reusable search input with:
 * - Built-in debounce (fires onChange after user stops typing)
 * - Clear button
 * - Cmd+K / Ctrl+K global shortcut to focus
 */
export default function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  debounce = 300,
  shortcutKey = "k",
  count = null,
  enableSlashShortcut = true,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shortcutLabel = useMemo(() => {
    if (typeof navigator === "undefined") return "⌘K";
    const ua = navigator.userAgent;
    const isMac = /Mac|iPhone|iPad|iPod/i.test(ua);
    return isMac ? "⌘K" : "Ctrl+K";
  }, []);

  // Sync external value changes (e.g. cleared by parent)
  useEffect(() => {
    setLocal(value);
  }, [value]);

  const emitChange = useCallback(
    (v: string) => {
      clearTimeout(timerRef.current);
      if (debounce <= 0) {
        onChange(v);
      } else {
        timerRef.current = setTimeout(() => onChange(v), debounce);
      }
    },
    [onChange, debounce]
  );

  function handleChange(v: string) {
    setLocal(v);
    emitChange(v);
  }

  function handleClear() {
    setLocal("");
    clearTimeout(timerRef.current);
    onChange("");
    inputRef.current?.focus();
  }

  // Global Cmd+K / Ctrl+K (and optional "/") to focus
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Cmd/Ctrl + key
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === shortcutKey.toLowerCase()) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      // "/" key when not already typing in an editable field
      if (enableSlashShortcut && e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const isEditable =
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          (target?.isContentEditable ?? false);
        if (!isEditable) {
          e.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcutKey, enableSlashShortcut]);

  return (
    <div className="relative group">
      <input
        ref={inputRef}
        className="h-8 w-full rounded-xl border border-black/6 dark:border-white/8 bg-white/40 dark:bg-white/4 backdrop-blur-lg px-4 pr-8 text-sm outline-none transition-all duration-200 placeholder:text-muted-foreground/60 focus:border-primary/30 focus:ring-2 focus:ring-primary/15 focus:bg-white/60 dark:focus:bg-white/6"
        placeholder={placeholder}
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (local) {
              handleClear();
            } else {
              inputRef.current?.blur();
            }
          }
        }}
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
        {count && (count.current !== count.total || local) && (
          <span
            className={cn(
              "hidden sm:inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums leading-none transition-colors",
              count.current === 0
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "bg-primary/12 text-primary",
            )}
            title={`${count.current} / ${count.total}`}
          >
            {count.current}
            <span className="opacity-50 mx-0.5">/</span>
            {count.total}
          </span>
        )}
        {local ? (
          <button
            className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer pointer-events-auto"
            onClick={handleClear}
            tabIndex={-1}
            aria-label="Clear"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd className="hidden sm:inline-flex items-center rounded-md glass-badge px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/50">
            {shortcutLabel}
          </kbd>
        )}
      </div>
    </div>
  );
}
