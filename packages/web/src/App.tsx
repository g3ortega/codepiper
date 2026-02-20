import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from "react-router-dom";
import { AuthGate } from "@/components/auth/AuthGate";
import { Header } from "@/components/layout/Header";
import { MobileNav } from "@/components/layout/MobileNav";
import { Sidebar } from "@/components/layout/Sidebar";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import { websocketManager } from "@/lib/websocket";
import DashboardPage from "@/pages/DashboardPage";
import { SessionsPage } from "@/pages/SessionsPage";

const AnalyticsPage = lazy(async () => {
  const mod = await import("@/pages/AnalyticsPage");
  return { default: mod.AnalyticsPage };
});

const PoliciesPage = lazy(async () => {
  const mod = await import("@/pages/PoliciesPage");
  return { default: mod.PoliciesPage };
});

const SessionDetailPage = lazy(async () => {
  const mod = await import("@/pages/SessionDetailPage");
  return { default: mod.SessionDetailPage };
});

const SettingsPage = lazy(async () => {
  const mod = await import("@/pages/SettingsPage");
  return { default: mod.SettingsPage };
});

const WorkflowsPage = lazy(async () => {
  const mod = await import("@/pages/WorkflowsPage");
  return { default: mod.WorkflowsPage };
});

function PageLoading() {
  return <div className="p-6 text-sm text-muted-foreground">Loading page...</div>;
}

function isTextInputElement(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    if (target.disabled || target.readOnly) {
      return false;
    }
    const type = target.type?.toLowerCase() ?? "text";
    return !["button", "checkbox", "file", "hidden", "radio", "range", "reset", "submit"].includes(
      type
    );
  }
  return false;
}

function useViewportKeyboardState(): { keyboardOpen: boolean } {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const viewport = window.visualViewport;
    const coarsePointerMedia = window.matchMedia("(pointer: coarse)");
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const commitState = () => {
      const coarsePointer = coarsePointerMedia.matches;
      const focusedTextInput = isTextInputElement(document.activeElement);
      const likelyKeyboardOpen = coarsePointer && focusedTextInput;

      setKeyboardOpen((previous) =>
        previous === likelyKeyboardOpen ? previous : likelyKeyboardOpen
      );
      document.documentElement.classList.toggle("keyboard-open", likelyKeyboardOpen);
    };

    const scheduleCommit = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        commitState();
      });
    };

    const handleFocusOut = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(scheduleCommit, 120);
    };

    commitState();

    viewport?.addEventListener("resize", scheduleCommit);
    viewport?.addEventListener("scroll", scheduleCommit);
    window.addEventListener("resize", scheduleCommit);
    window.addEventListener("orientationchange", scheduleCommit);
    window.addEventListener("focusin", scheduleCommit);
    window.addEventListener("focusout", handleFocusOut);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      viewport?.removeEventListener("resize", scheduleCommit);
      viewport?.removeEventListener("scroll", scheduleCommit);
      window.removeEventListener("resize", scheduleCommit);
      window.removeEventListener("orientationchange", scheduleCommit);
      window.removeEventListener("focusin", scheduleCommit);
      window.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  return { keyboardOpen };
}

function AppShell() {
  const location = useLocation();
  const isSessionDetail = /^\/sessions\/[^/]+/.test(location.pathname);
  const { keyboardOpen } = useViewportKeyboardState();
  const mainClassName = cn(
    "flex-1 overflow-auto md:pb-0",
    keyboardOpen ? "pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]" : "pb-36"
  );

  return (
    <AuthGate>
      <NotificationProvider>
        <div className="flex h-[100dvh] app-background noise">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Hide header on mobile session detail — session header has its own nav */}
            <div className={isSessionDetail ? "hidden md:block" : ""}>
              <Header />
            </div>
            <main className={mainClassName}>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/sessions" element={<SessionsPage />} />
                <Route
                  path="/sessions/:id"
                  element={
                    <Suspense fallback={<PageLoading />}>
                      <SessionDetailPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/sessions/:id/:tab"
                  element={
                    <Suspense fallback={<PageLoading />}>
                      <SessionDetailPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/analytics"
                  element={
                    <Suspense fallback={<PageLoading />}>
                      <AnalyticsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/workflows"
                  element={
                    <Suspense fallback={<PageLoading />}>
                      <WorkflowsPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/policies"
                  element={
                    <Suspense fallback={<PageLoading />}>
                      <PoliciesPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <Suspense fallback={<PageLoading />}>
                      <SettingsPage />
                    </Suspense>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
          <MobileNav keyboardOpen={keyboardOpen} />
        </div>
      </NotificationProvider>
    </AuthGate>
  );
}

function App() {
  useEffect(() => {
    websocketManager.connect();

    return () => {
      websocketManager.close();
    };
  }, []);

  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <AppShell />
          <Toaster />
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
