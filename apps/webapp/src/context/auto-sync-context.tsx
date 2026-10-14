import React, { createContext, useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { useAppContext } from "./app-context";
import { useOptionalAuth } from "./auth-provider";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { resolveUXStatus, type SyncStatus, type UXSyncState } from "@quozen/core";

export interface AutoSyncContextType {
    isPaused: boolean;
    setPaused: (paused: boolean) => void;
    isEnabled: boolean;
    lastSyncTime: Date | null;
    triggerSync: () => Promise<void>;
    isOnline: boolean;
    syncStatus: SyncStatus;
    uxSyncState: UXSyncState;
    reconnectProvider: () => Promise<void>;
}

// Export Context so the hook can use it
export const AutoSyncContext = createContext<AutoSyncContextType | undefined>(undefined);

const UNSAFE_ROUTES = ["/add-expense", "/edit-expense", "/join"];
const DEFAULT_POLLING_INTERVAL = Number(import.meta.env.VITE_POLLING_INTERVAL || 30);

declare global {
    interface Window {
        __QUOZEN_POLLING_OVERRIDE?: number;
        __triggerAutoSync?: () => Promise<void>;
    }
}

export function AutoSyncProvider({
    children,
    pollingInterval: propInterval = DEFAULT_POLLING_INTERVAL
}: {
    children: React.ReactNode;
    pollingInterval?: number;
}) {
    const pollingInterval = window.__QUOZEN_POLLING_OVERRIDE || propInterval;
    const { activeGroupId } = useAppContext();
    const auth = useOptionalAuth();
    const { toast } = useToast();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const location = useLocation();

    const [manualPaused, setManualPaused] = useState(false);
    const [routePaused, setRoutePaused] = useState(false);
    const [pageHidden, setPageHidden] = useState(document.hidden);
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
    const [isOnline, setIsOnline] = useState<boolean>(() =>
        typeof navigator !== "undefined" ? navigator.onLine !== false : true
    );
    const [syncStatus, setSyncStatus] = useState<SyncStatus>(() =>
        quozen.syncProvider?.getStatus?.() || "idle"
    );

    const lastKnownRemoteTimeRef = useRef<string | null>(null);
    const prevStatusRef = useRef<SyncStatus>("idle");
    const wasOnlineRef = useRef<boolean>(isOnline);

    // We use a ref to hold the latest check function to avoid restarting the interval
    // whenever the dependencies of checkUpdates change.
    const checkUpdatesRef = useRef<() => Promise<void>>(async () => { });

    const isEnabled = pollingInterval > 0;
    const isPaused = manualPaused || routePaused || pageHidden || !activeGroupId;

    useEffect(() => {
        if (isEnabled) {
            console.debug(`[AutoSync] Initialized. Interval: ${pollingInterval}s`);
        } else {
            console.debug("[AutoSync] Disabled (Interval is 0).");
        }
    }, [isEnabled, pollingInterval]);

    // 1. Route Guard
    useEffect(() => {
        const isUnsafe = UNSAFE_ROUTES.some(route => location.pathname.startsWith(route));
        setRoutePaused(isUnsafe);
    }, [location.pathname]);

    // 2. Visibility Guard
    useEffect(() => {
        const handleVisibilityChange = () => setPageHidden(document.hidden);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, []);

    // 3. Online / Offline Listeners + 30s Origin Heartbeat (Quomida Pattern)
    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        let heartbeatId: ReturnType<typeof setInterval> | undefined;
        if (import.meta.env.MODE !== "test") {
            heartbeatId = setInterval(async () => {
                if (typeof navigator !== "undefined" && !navigator.onLine) {
                    setIsOnline(false);
                    return;
                }
                try {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 5000);
                    await fetch(`${window.location.origin}/?hb=${Date.now()}`, {
                        method: "HEAD",
                        cache: "no-store",
                        signal: controller.signal
                    });
                    clearTimeout(timeout);
                    setIsOnline(true);
                } catch {
                    setIsOnline(false);
                }
            }, 30000);
        }

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
            if (heartbeatId) clearInterval(heartbeatId);
        };
    }, []);

    // 4. Subscribe to ReplicationCoordinator / CloudSyncProvider status changes
    useEffect(() => {
        const replication = (quozen as any).replication;
        const provider = (quozen as any).syncProvider;

        const handleNewStatus = (newStatus: SyncStatus) => {
            const prev = prevStatusRef.current;
            prevStatusRef.current = newStatus;
            setSyncStatus(newStatus);

            if (prev === "syncing" && newStatus === "idle") {
                const syncedTimeStr = provider?.getLastSyncedTime?.();
                setLastSyncTime(syncedTimeStr ? new Date(syncedTimeStr) : new Date());
                if (activeGroupId) {
                    void queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
                }
            } else if (newStatus !== prev) {
                if (newStatus === "corrupted") {
                    window.dispatchEvent(new CustomEvent("schema-error", { detail: "CORRUPTED" }));
                } else if (newStatus === "upgrade_required") {
                    window.dispatchEvent(new CustomEvent("schema-error", { detail: "UPGRADE_REQUIRED" }));
                } else if (newStatus === "auth_failed") {
                    toast({
                        title: t("sync.cloudSyncFailedTitle"),
                        description: t("sync.diagnostics.auth_failed"),
                        variant: "destructive"
                    });
                }
            }
        };

        if (replication?.status$?.subscribe) {
            const sub = replication.status$.subscribe(handleNewStatus);
            return () => sub.unsubscribe();
        } else if (provider?.onStatusChange) {
            return provider.onStatusChange(handleNewStatus);
        }
    }, [activeGroupId, queryClient, toast, t]);

    // Core Sync Logic
    const checkUpdates = useCallback(async () => {
        if (!activeGroupId || !isEnabled) return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            setIsOnline(false);
            return;
        }

        try {
            if (quozen.syncProvider && !quozen.syncProvider.isInitialized()) {
                await quozen.syncProvider.initialize();
            }
            if (quozen.replication) {
                await quozen.replication.sync(activeGroupId);
                setLastSyncTime(new Date());
            }

            // Fetch metadata only
            const remoteTimeStr = await quozen.getLastModified(activeGroupId);

            if (!lastKnownRemoteTimeRef.current) {
                // First check, initialize
                lastKnownRemoteTimeRef.current = remoteTimeStr;
                if (quozen.replication) {
                    await queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
                }
            } else if (new Date(remoteTimeStr).getTime() > new Date(lastKnownRemoteTimeRef.current).getTime()) {
                // Remote is newer -> Invalidate
                await queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
                lastKnownRemoteTimeRef.current = remoteTimeStr;
                setLastSyncTime(new Date());
            }
        } catch (e) {
            // Use debug to prevent console flooding on network loss
            console.debug("[AutoSync] Polling failed (silent):", e);
        }
    }, [activeGroupId, isEnabled, queryClient]);

    // Keep the ref updated with the latest callback
    useEffect(() => {
        checkUpdatesRef.current = checkUpdates;
    }, [checkUpdates]);

    // Automatically trigger sync when transitioning from offline -> online
    useEffect(() => {
        if (!wasOnlineRef.current && isOnline) {
            void checkUpdatesRef.current();
        }
        wasOnlineRef.current = isOnline;
    }, [isOnline]);

    // Expose explicit trigger for E2E tests to enable deterministic syncing
    useEffect(() => {
        window.__triggerAutoSync = checkUpdates;
        return () => {
            delete window.__triggerAutoSync;
        };
    }, [checkUpdates]);

    // 5. Polling Loop
    // This effect is now stable and won't reset on re-renders unless paused state changes
    useEffect(() => {
        if (isPaused || !isEnabled) return;

        const executeCheck = () => {
            checkUpdatesRef.current();
        };

        // Perform an immediate check on mount/resume
        executeCheck();

        const intervalId = setInterval(executeCheck, pollingInterval * 1000);

        return () => clearInterval(intervalId);
    }, [isPaused, isEnabled, pollingInterval]);

    // Reset ref when switching groups
    useEffect(() => {
        lastKnownRemoteTimeRef.current = null;
    }, [activeGroupId]);

    const reconnectProvider = useCallback(async () => {
        if (auth?.login) {
            auth.login();
        } else if (quozen.syncProvider) {
            await quozen.syncProvider.initialize();
            await checkUpdatesRef.current();
        }
    }, [auth]);

    const uxSyncState = useMemo<UXSyncState>(() => {
        const providerConnected = Boolean(quozen.syncProvider?.isInitialized?.() ?? auth?.isAuthenticated ?? true);
        return resolveUXStatus({
            isOnline,
            providerConnected,
            providerStatus: syncStatus
        });
    }, [isOnline, syncStatus, auth?.isAuthenticated]);

    const value = useMemo(() => ({
        isPaused,
        setPaused: setManualPaused,
        isEnabled,
        lastSyncTime,
        triggerSync: checkUpdates,
        isOnline,
        syncStatus,
        uxSyncState,
        reconnectProvider
    }), [isPaused, isEnabled, lastSyncTime, checkUpdates, isOnline, syncStatus, uxSyncState, reconnectProvider]);

    return (
        <AutoSyncContext.Provider value={value}>
            {children}
        </AutoSyncContext.Provider>
    );
}
