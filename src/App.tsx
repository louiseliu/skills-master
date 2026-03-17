import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import SkillsManager from "./pages/SkillsManager";
import Marketplace from "./pages/Marketplace";
import SettingsPage from "./pages/Settings";
import { useTheme } from "./hooks/useTheme";

function AppInner() {
  const queryClient = useQueryClient();
  useTheme();

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen("skills-changed", () => {
      queryClient.invalidateQueries();
    })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [queryClient]);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="skills" element={<SkillsManager />} />
        <Route path="marketplace" element={<Marketplace />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
