import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import Dashboard from "@/pages/dashboard";
import ActivityHub from "@/pages/activity-hub";
import EditExpense from "@/pages/edit-expense";
import Groups from "@/pages/groups";
import Profile from "@/pages/profile";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import JoinPage from "@/pages/join";
import BottomNavigation from "@/components/bottom-navigation";
import Header from "@/components/header";
import SiteFooter from "@/components/site-footer";
import { AppContext, useAppContext, SettlementDraftState } from "@/context/app-context";
import { AuthProvider, useAuth } from "@/context/auth-provider";
import { useSettings } from "@/hooks/use-settings";
import { useGroups } from "@/hooks/use-groups";
import { AutoSyncProvider } from "@/context/auto-sync-context";
import { useTranslation } from "react-i18next";
import PullToRefresh from "@/components/pull-to-refresh";
import { useAutoSync } from "@/hooks/use-auto-sync";
import AddExpenseDrawer from "@/components/add-expense-drawer";
import SettlementModal from "@/components/settlement-modal";
import SchemaRemediationModal from "@/components/schema-remediation-modal";
import GroupUnavailableModal from "@/components/group-unavailable-modal";
import { AiFeatureProvider } from "@/features/agent/AiFeatureProvider";
import { PwaUpdateProvider } from "@/hooks/use-pwa-update";
import { quozen } from "@/lib/storage";
import { AlertCircle } from "lucide-react";
import type { ExpenseDraft, SettlementDraft } from "@quozen/core";

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-xl">{t("common.loading")}</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const autoSync = useAutoSync();
  const { activeGroupId, currentUserId, settlementDraftState, setSettlementDraftState } = useAppContext();
  const { settings } = useSettings();
  const { t } = useTranslation();
  const triggerSync = autoSync?.triggerSync || (async () => { });
  const isEnabled = autoSync?.isEnabled || false;
  const isPaused = autoSync?.isPaused || false;

  const isArchived = Boolean(activeGroupId && settings?.archivedGroupCache?.some(g => g.id === activeGroupId));

  const { data: ledger } = useQuery({
    queryKey: ["drive", "group", activeGroupId],
    queryFn: () => quozen.ledger(activeGroupId, currentUserId).getLedger(),
    enabled: !!activeGroupId && settlementDraftState.isOpen,
  });

  return (
    <div className="max-w-md mx-auto bg-background shadow-2xl min-h-screen relative border-x border-border">
      <Header />
      {isArchived && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 text-amber-900 dark:text-amber-200 px-4 py-2 text-xs flex items-center gap-2" data-testid="archived-banner">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{t("groups.readOnlyBanner")}</span>
        </div>
      )}
      <main className="pb-20 relative">
        <PullToRefresh
          onRefresh={triggerSync}
          enabled={isEnabled && !isPaused}
        >
          {children}
        </PullToRefresh>
      </main>
      <SiteFooter />
      <BottomNavigation />
      <AddExpenseDrawer />
      <SettlementModal
        isOpen={settlementDraftState.isOpen}
        onClose={() => setSettlementDraftState(prev => ({ ...prev, isOpen: false, draft: undefined, initialData: undefined }))}
        fromUser={settlementDraftState.fromUser}
        toUser={settlementDraftState.toUser}
        suggestedAmount={settlementDraftState.suggestedAmount}
        initialData={settlementDraftState.initialData}
        draft={settlementDraftState.draft}
        draftMeta={settlementDraftState.meta}
        users={ledger?.members || []}
      />
      <SchemaRemediationModal />
      <GroupUnavailableModal />
    </div>
  );
};

export function AuthenticatedApp() {
  const [activeGroupId, setActiveGroupIdState] = useState<string>(
    () => (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("quozen_active_group_id") : null) || (typeof localStorage !== "undefined" ? localStorage.getItem("quozen_active_group_id") : null) || ""
  );
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft | null>(null);
  const [expenseDraftMeta, setExpenseDraftMeta] = useState<{ rawInput?: string; isAiEscalated?: boolean; ambiguities?: string[] } | null>(null);

  const [settlementDraftState, setSettlementDraftState] = useState<SettlementDraftState>({ isOpen: false });

  const [schemaErrorStatus, setSchemaErrorStatus] = useState<'CORRUPTED' | 'UPGRADE_REQUIRED' | 'INCOMPATIBLE' | null>(null);

  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const { settings, updateActiveGroup, updateGroupAccount, isLoading: settingsLoading, error: settingsError } = useSettings();
  const { groups } = useGroups();

  const appLoading = authLoading || (isAuthenticated && !settings && settingsLoading);

  useEffect(() => {
    if (settingsError) {
      const errMsg = String(settingsError?.message || settingsError);
      if (errMsg.includes("401") || errMsg.includes("Session expired")) {
        console.warn("Session expired detected in App. Logging out.");
        logout();
        navigate("/login");
      } else if (errMsg.includes("403") || errMsg.includes("Forbidden")) {
        console.error("403 Forbidden detected. The user likely didn't grant Google Drive permissions.");
        logout();
        navigate("/login", { 
          state: { message: t("join.accessDenied") || "Google Drive access denied. Please grant permissions when signing in." } 
        });
      }
    }
  }, [settingsError, logout, navigate, t]);

  useEffect(() => {
    const handleSchemaError = (e: any) => {
      const detail = e.detail;
      if (typeof detail === "object" && detail !== null) {
        if (detail.groupId && activeGroupId && detail.groupId !== activeGroupId) {
          return;
        }
        setSchemaErrorStatus(detail.status);
      } else {
        setSchemaErrorStatus(detail);
      }
    };
    window.addEventListener('schema-error', handleSchemaError);
    return () => window.removeEventListener('schema-error', handleSchemaError);
  }, [activeGroupId]);

  const handleSetActiveGroupId = (groupId: string) => {
    if (groupId && groupId === activeGroupId) return;
    setActiveGroupIdState(groupId);
    if (typeof sessionStorage !== "undefined") {
      if (groupId) {
        sessionStorage.setItem("quozen_active_group_id", groupId);
      } else {
        sessionStorage.removeItem("quozen_active_group_id");
      }
    }
    if (typeof localStorage !== "undefined") {
      if (groupId) {
        localStorage.setItem("quozen_active_group_id", groupId);
      } else {
        localStorage.removeItem("quozen_active_group_id");
      }
    }
    if (groupId) {
      void queryClient.invalidateQueries({ queryKey: ["drive", "group", groupId] });
    }
    if (groupId && quozen.syncProvider && typeof (quozen.syncProvider as any).setActiveGroupId === "function") {
      (quozen.syncProvider as any).setActiveGroupId(groupId);
    }
    if (isAuthenticated) {
      updateActiveGroup(groupId);
    }
  };

  useEffect(() => {
    if (activeGroupId && quozen.syncProvider && typeof (quozen.syncProvider as any).setActiveGroupId === "function") {
      (quozen.syncProvider as any).setActiveGroupId(activeGroupId);
    }
  }, [activeGroupId]);

  const activeCachedGroup = settings?.groupCache?.find(g => g.id === activeGroupId);
  const currentUserId = activeCachedGroup?.accountId || user?.id || "";

  const handleSetActiveAccountId = (accountId: string) => {
    if (activeGroupId && isAuthenticated && updateGroupAccount) {
      updateGroupAccount({ groupId: activeGroupId, accountId });
    }
  };

  const openExpenseWithDraft = (
    draft: ExpenseDraft,
    meta?: { rawInput?: string; isAiEscalated?: boolean; ambiguities?: string[] }
  ) => {
    setExpenseDraft(draft);
    setExpenseDraftMeta(meta || null);
    setIsAddExpenseOpen(true);
  };

  const openSettlementWithDraft = (
    draft: SettlementDraft,
    meta?: { rawInput?: string; isAiEscalated?: boolean; ambiguities?: string[] }
  ) => {
    setSettlementDraftState({
      isOpen: true,
      draft,
      meta
    });
  };

  useEffect(() => {
    if (appLoading) return;

    if (isAuthenticated && user) {
      const isCurrentValid = Boolean(activeGroupId && groups.some(g => g.id === activeGroupId));

      if (isCurrentValid) {
        if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("quozen_active_group_id") !== activeGroupId) {
          sessionStorage.setItem("quozen_active_group_id", activeGroupId);
        }
        if (typeof localStorage !== "undefined" && localStorage.getItem("quozen_active_group_id") !== activeGroupId) {
          localStorage.setItem("quozen_active_group_id", activeGroupId);
        }
        return;
      }

      if (!activeGroupId) {
        const sessionCandidate = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("quozen_active_group_id") : null;
        const localCandidate = typeof localStorage !== "undefined" ? localStorage.getItem("quozen_active_group_id") : null;
        const cloudCandidate = settings?.activeGroupId ?? null;

        const resolvedCandidate = [sessionCandidate, localCandidate, cloudCandidate].find(
          id => Boolean(id && groups.some(g => g.id === id))
        ) || groups[0]?.id || "";

        if (resolvedCandidate) {
          if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem("quozen_active_group_id", resolvedCandidate);
          }
          if (typeof localStorage !== "undefined") {
            localStorage.setItem("quozen_active_group_id", resolvedCandidate);
          }
          setActiveGroupIdState(resolvedCandidate);
          if (quozen.syncProvider && typeof (quozen.syncProvider as any).setActiveGroupId === "function") {
            (quozen.syncProvider as any).setActiveGroupId(resolvedCandidate);
          }
        } else if (groups.length === 0) {
          const allowedPaths = ['/groups', '/profile', '/join'];
          const isAllowed = allowedPaths.some(path => location.pathname.startsWith(path));

          if (!isAllowed) {
            navigate('/groups', { replace: true });
          }
        }
      } else {
        const fallbackId = groups[0]?.id || "";
        setActiveGroupIdState(fallbackId);
        if (typeof sessionStorage !== "undefined") {
          if (fallbackId) {
            sessionStorage.setItem("quozen_active_group_id", fallbackId);
          } else {
            sessionStorage.removeItem("quozen_active_group_id");
          }
        }
        if (typeof localStorage !== "undefined") {
          if (fallbackId) {
            localStorage.setItem("quozen_active_group_id", fallbackId);
          } else {
            localStorage.removeItem("quozen_active_group_id");
          }
        }
        if (fallbackId && quozen.syncProvider && typeof (quozen.syncProvider as any).setActiveGroupId === "function") {
          (quozen.syncProvider as any).setActiveGroupId(fallbackId);
        }
        if (groups.length === 0) {
          const allowedPaths = ['/groups', '/profile', '/join'];
          const isAllowed = allowedPaths.some(path => location.pathname.startsWith(path));

          if (!isAllowed) {
            navigate('/groups', { replace: true });
          }
        }
      }
    }
  }, [
    user,
    isAuthenticated,
    appLoading,
    groups,
    settings,
    activeGroupId,
    navigate,
    location.pathname
  ]);

  if (isAuthenticated && appLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background" data-testid="app-loading">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{
      activeGroupId,
      setActiveGroupId: handleSetActiveGroupId,
      currentUserId,
      setActiveAccountId: handleSetActiveAccountId,
      isAddExpenseOpen,
      setIsAddExpenseOpen,
      expenseDraft,
      setExpenseDraft,
      expenseDraftMeta,
      openExpenseWithDraft,
      settlementDraftState,
      setSettlementDraftState,
      openSettlementWithDraft,
      schemaErrorStatus,
      setSchemaErrorStatus
    }}>
      <AutoSyncProvider>
        <AiFeatureProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/join/:id" element={<JoinPage />} />

            <Route
              path="/dashboard"
              element={<ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>}
            />
            <Route
              path="/expenses"
              element={<ProtectedRoute><AppLayout><ActivityHub /></AppLayout></ProtectedRoute>}
            />

            <Route
              path="/edit-expense/:id"
              element={<ProtectedRoute><AppLayout><EditExpense /></AppLayout></ProtectedRoute>}
            />
            <Route
              path="/groups"
              element={<ProtectedRoute><AppLayout><Groups /></AppLayout></ProtectedRoute>}
            />
            <Route
              path="/profile"
              element={<ProtectedRoute><AppLayout><Profile /></AppLayout></ProtectedRoute>}
            />
            <Route
              path="/"
              element={
                authLoading ? <div>{t("common.loading")}</div> :
                  isAuthenticated ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <Toaster />
        </AiFeatureProvider>
      </AutoSyncProvider>
    </AppContext.Provider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <PwaUpdateProvider>
            <AuthProvider>
              <AuthenticatedApp />
            </AuthProvider>
          </PwaUpdateProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

export default App;
