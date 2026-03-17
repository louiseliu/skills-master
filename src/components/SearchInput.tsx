import { useRef, useEffect, useCallback, useState } from "react";
import { Search, X } from "lucide-react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Debounce delay in ms. 0 = no debounce (instant). Default 300. */
  debounce?: number;
  /** Global keyboard shortcut to focus. Default: "k" (Cmd+K / Ctrl+K). */
  shortcutKey?: string;
}

/**
 * Reusable search input with:
 * - Built-in debounce (fires onChange after user stops typing)
 * - Clear button
 * - Cmd+K / Ctrl+K global shortcut to focus
 * - Search icon
 */
export default function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  debounce = 300,
  shortcutKey = "k",
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  // Global Cmd+K / Ctrl+K to focus
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === shortcutKey) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcutKey]);

  return (
    <div className="relative group">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
      <input
        ref={inputRef}
        className="h-8 w-full rounded-lg border border-input bg-background pl-9 pr-8 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
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
      {local ? (
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onClick={handleClear}
          tabIndex={-1}
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center rounded border border-border bg-muted px-1 text-[10px] font-medium text-muted-foreground/60 pointer-events-none">
          ⌘K
        </kbd>
      )}
    </div>
  );
}
