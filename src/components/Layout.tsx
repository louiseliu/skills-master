import { NavLink, Outlet } from "react-router-dom";
import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { LayoutDashboard, Puzzle, Store, Settings, GitBranch, FolderOpen } from "lucide-react";
import logoUrl from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import ImportWizard from "@/components/ImportWizard";
import { useResizable } from "@/hooks/useResizable";
import ResizeHandle from "@/components/ResizeHandle";
import { useAgents } from "@/hooks/useAgents";
import { useSkills } from "@/hooks/useSkills";

// Hoisted outside component — stable reference, no re-creation per render
const NAV_LINK_BASE = "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium border outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-[color,background-color,border-color,box-shadow,opacity] duration-150";
const NAV_LINK_ACTIVE = `${NAV_LINK_BASE} bg-primary/[0.08] dark:bg-primary/[0.12] border-primary/20 dark:border-primary/15 shadow-[inset_0_1px_0_var(--primary)/8%,0_0_8px_var(--primary)/6%] text-primary backdrop-blur-sm`;
const NAV_LINK_INACTIVE = `${NAV_LINK_BASE} border-transparent text-sidebar-foreground/75 hover:text-primary/80 hover:bg-primary/[0.04] dark:hover:bg-primary/[0.06]`;

function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? NAV_LINK_ACTIVE : NAV_LINK_INACTIVE;
}

const isMac = navigator.platform.toLowerCase().includes("mac");

export default function Layout() {
  const { t } = useTranslation();
  const [importMode, setImportMode] = useState<"git" | "local" | null>(null);
  const [importLocalPath, setImportLocalPath] = useState<string | null>(null);
  const pickingFolder = useRef(false);
  const { isLoading: agentsLoading } = useAgents();
  const { data: skills, isLoading: skillsLoading } = useSkills();

  const sidebar = useResizable({
    initial: 200,
    min: 200,
    max: 320,
    storageKey: "sidebar-width",
  });

  const handleImportLocal = useCallback(async () => {
    if (pickingFolder.current) return; // prevent double-open
    pickingFolder.current = true;
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        setImportLocalPath(selected);
        setImportMode("local");
      }
    } finally {
      pickingFolder.current = false;
    }
  }, []);

  const onDragRegionMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.buttons !== 1) return;
    e.preventDefault();
    if (e.detail === 2) {
      getCurrentWindow().toggleMaximize();
    } else {
      getCurrentWindow().startDragging();
    }
  }, []);

  const loading = agentsLoading || skillsLoading;

  return (
    <div className="relative flex h-screen overflow-hidden bg-background">

      {/* Sidebar — floating glass panel */}
      <aside
        aria-label="Sidebar"
        className="flex shrink-0 flex-col m-2 mr-0 rounded-2xl glass-panel"
        style={{ width: sidebar.width }}
      >
        {/* Draggable title bar + logo — extra top padding on macOS for traffic lights */}
        <div
          className="shrink-0 flex items-end px-3 pb-3 cursor-default"
          style={{ paddingTop: isMac ? 42 : 12 }}
          onMouseDown={onDragRegionMouseDown}
        >
          <div className="flex items-center gap-2.5">
            <img src={logoUrl} alt="" width={30} height={30} className="size-[30px] rounded-[8px] shadow-sm ring-1 ring-black/5" />
            <span className="text-[15px] font-semibold text-sidebar-foreground tracking-tight select-none">
              技能管家
            </span>
          </div>
        </div>

        {loading ? (
          /* ── Sidebar skeleton ── */
          <div className="flex flex-1 flex-col px-3 pb-3 animate-pulse">
            <div className="space-y-1.5 pb-3">
              <div className="h-8 rounded-xl bg-muted/50" />
              <div className="h-8 rounded-xl bg-muted/50" />
            </div>
            <div className="space-y-1">
              <div className="h-9 rounded-xl bg-muted/40" />
              <div className="h-9 rounded-xl bg-muted/40" />
              <div className="h-9 rounded-xl bg-muted/40" />
            </div>
            <div className="flex-1" />
            <div className="h-9 rounded-xl bg-muted/40" />
          </div>
        ) : (
          <>
            {/* Import buttons */}
            <div className="px-3 pb-3 space-y-1.5">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 rounded-xl border-dashed"
                onClick={() => setImportMode("git")}
              >
                <GitBranch className="size-3.5" aria-hidden="true" />
                {t("repos.importRepo")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 rounded-xl border-dashed"
                onClick={handleImportLocal}
              >
                <FolderOpen className="size-3.5" aria-hidden="true" />
                {t("repos.importLocal")}
              </Button>
            </div>

            {/* Main nav + agents in scrollable area */}
            <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
              {/* Top nav */}
              <NavLink to="/" end className={navLinkClass}>
                <LayoutDashboard className="size-4" aria-hidden="true" />
                {t("sidebar.dashboard")}
              </NavLink>

              <NavLink to="/skills" className={navLinkClass}>
                <Puzzle className="size-4" aria-hidden="true" />
                {t("sidebar.skills")}
                {skills && (
                  <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
                    {skills.length}
                  </span>
                )}
              </NavLink>

              <NavLink to="/marketplace" className={navLinkClass}>
                <Store className="size-4" aria-hidden="true" />
                {t("sidebar.marketplace")}
              </NavLink>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Bottom nav */}
              <div className="pt-2">
                <NavLink to="/settings" className={navLinkClass}>
                  <Settings className="size-4" aria-hidden="true" />
                  {t("sidebar.settings")}
                </NavLink>
              </div>
            </nav>
          </>
        )}

      </aside>

      <ResizeHandle onMouseDown={sidebar.onMouseDown} />

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col relative">
        {/* Draggable title bar — overlay, does not push content down */}
        <div
          className="absolute inset-x-0 top-0 z-10 cursor-default select-none"
          style={{ height: isMac ? 42 : 32, WebkitAppRegion: "drag" } as React.CSSProperties}
          onMouseDown={onDragRegionMouseDown}
        />
        <main className="flex-1 min-w-0 overflow-y-auto">
          {loading ? (
            <div className="p-8 space-y-4 animate-pulse" style={{ paddingTop: isMac ? 58 : 48 }}>
              <div className="h-7 w-48 rounded-lg bg-muted/50" />
              <div className="grid grid-cols-3 gap-4">
                <div className="h-24 rounded-2xl bg-muted/30" />
                <div className="h-24 rounded-2xl bg-muted/30" />
                <div className="h-24 rounded-2xl bg-muted/30" />
              </div>
              <div className="h-5 w-32 rounded bg-muted/40 mt-6" />
              <div className="space-y-2">
                <div className="h-14 rounded-xl bg-muted/25" />
                <div className="h-14 rounded-xl bg-muted/25" />
                <div className="h-14 rounded-xl bg-muted/25" />
                <div className="h-14 rounded-xl bg-muted/25" />
              </div>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>

      {importMode && (
        <ImportWizard
          mode={importMode}
          initialLocalPath={importLocalPath}
          onClose={() => { setImportMode(null); setImportLocalPath(null); }}
        />
      )}
    </div>
  );
}
