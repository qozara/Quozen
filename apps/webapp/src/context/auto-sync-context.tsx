import React, { createContext, useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { useAppContext } from "./app-context";
import { useOptionalAuth } from "./auth-provider";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { resolveUXStatus, GroupFileUnavailableError, type SyncStatus, type UXSyncState } from "@quozen/core";

export function isGoogle401Error(err: any): boolean {
    if (!err) return false;
    const status = err?.status ?? err?.response?.status ?? err?.statusCode;
    if (status === 401) return true;
    if (status && status !== 401) return false;

    const msg = String(err?.message || err);
    if (msg.includes("403")) return false;
    return msg.includes("401") || msg.toLowerCase().includes("session expired");
}

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
    const navigate = useNavigate();

    const [manualPaused, setManualPaused] = useState(false);
    const [routePaused, setRoutePaused] = useState(false);
    const [pageHidden, setPageHidden] = useState(document.hidden);
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
    const lastSyncTimeRef = useRef<Date | null>(null);
    const [isOnline, setIsOnline] = useState<boolean>(() =>
        typeof navigator !== "undefined" ? navigator.onLine !== false : true
    );
    const [syncStatus, setSyncStatus] = useState<SyncStatus>(() =>
        quozen.syncProvider?.getStatus?.() || "idle"
    );

    const lastKnownRemoteTimeRef = useRef<string | null>(null);
    const prevActiveGroupIdRef = useRef<string>(activeGroupId);
    const prevStatusRef = useRef<SyncStatus>("idle");
    const wasOnlineRef = useRef<boolean>(isOnline);
    const lastSyncErrorRef = useRef<any>(null);

    const handleGoogleSessionExpired = useCallback(() => {
        if (!isOnline) return;
        if (auth?.logout) {
            auth.logout();
        }
        if (location.pathname !== "/login") {
            navigate("/login", { state: { from: location } });
        }
    }, [isOnline, auth, location, navigate]);

    // We use a ref to hold the latest check function to avoid restarting the interval
    // whenever the dependencies of checkUpdates change.
    const checkUpdatesRef = useRef<() => Promise<void>>(async () => { });

    const isEnabled = pollingInterval > 0;
    const isPaused = manualPaused || routePaused || pageHidden;
    const isPausedRef = useRef(isPaused);
    const isEnabledRef = useRef(isEnabled);

    useEffect(() => {
        isPausedRef.current = isPaused;
    }, [isPaused]);

    useEffect(() => {
        isEnabledRef.current = isEnabled;
    }, [isEnabled]);

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

    // 2. Visibility Guard & Focus Re-sync (throttled to 2 seconds)
    const lastFocusCheckRef = useRef<number>(Date.now());

    useEffect(() => {
        const maybeTriggerSync = () => {
            const now = Date.now();
            if (now - lastFocusCheckRef.current >= 2000) {
                lastFocusCheckRef.current = now;
                if (!isPausedRef.current && isEnabledRef.current) {
                    void checkUpdatesRef.current();
                }
            }
        };

        const handleVisibilityChange = () => {
            setPageHidden(document.hidden);
            if (!document.hidden) {
                maybeTriggerSync();
            }
        };

        const handleWindowFocus = () => {
            if (!document.hidden) {
                maybeTriggerSync();
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("focus", handleWindowFocus);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("focus", handleWindowFocus);
        };
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

        const handleNewStatus = (newStatus: SyncStatus, statusError?: any) => {
            const prev = prevStatusRef.current;
            prevStatusRef.current = newStatus;
            setSyncStatus(newStatus);

            if (prev === "syncing" && newStatus === "idle") {
                const syncedTimeStr = provider?.getLastSyncedTime?.();
                const now = syncedTimeStr ? new Date(syncedTimeStr) : new Date();
                setLastSyncTime(now);
                lastSyncTimeRef.current = now;
                void queryClient.invalidateQueries({ queryKey: ["drive", "settings"] });
                if (activeGroupId) {
                    void queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
                }
            } else if (newStatus !== prev) {
                const targetGroupId = provider?.getActiveGroupId?.() || activeGroupId;
                const isForActiveGroup = !targetGroupId || targetGroupId === activeGroupId;

                if (newStatus === "corrupted" && isForActiveGroup) {
                    window.dispatchEvent(new CustomEvent("schema-error", { detail: { status: "CORRUPTED", groupId: targetGroupId } }));
                } else if (newStatus === "upgrade_required" && isForActiveGroup) {
                    window.dispatchEvent(new CustomEvent("schema-error", { detail: { status: "UPGRADE_REQUIRED", groupId: targetGroupId } }));
                } else if (newStatus === "incompatible" && isForActiveGroup) {
                    window.dispatchEvent(new CustomEvent("schema-error", { detail: { status: "INCOMPATIBLE", groupId: targetGroupId } }));
                } else if (newStatus === "auth_failed") {
                    const err = (statusError !== undefined ? statusError : null)
                        || replication?.getLastError?.()
                        || provider?.getLastError?.()
                        || lastSyncErrorRef.current;

                    if (isOnline && isGoogle401Error(err)) {
                        handleGoogleSessionExpired();
                    } else {
                        toast({
                            title: t("sync.cloudSyncFailedTitle"),
                            description: t("sync.diagnostics.auth_failed"),
                            variant: "destructive"
                        });
                    }
                }
            }
        };

        if (replication?.status$?.subscribe) {
            const sub = replication.status$.subscribe(handleNewStatus);
            return () => sub.unsubscribe();
        } else if (provider?.onStatusChange) {
            return provider.onStatusChange(handleNewStatus);
        }
    }, [activeGroupId, queryClient, toast, t, isOnline, handleGoogleSessionExpired]);

    // Core Sync Logic
    const checkUpdates = useCallback(async () => {
        if (!isEnabled) return;
        if (syncStatus === "upgrade_required" || syncStatus === "corrupted") return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            setIsOnline(false);
            return;
        }

        try {
            if (quozen.syncProvider && !quozen.syncProvider.isInitialized()) {
                await quozen.syncProvider.initialize();
            }
            if (quozen.replication) {
                await quozen.replication.sync(activeGroupId || undefined);
                const now = new Date();
                setLastSyncTime(now);
                lastSyncTimeRef.current = now;
            }

            if (activeGroupId) {
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
            }

            await queryClient.invalidateQueries({ queryKey: ["drive", "settings"] });
        } catch (e: any) {
            lastSyncErrorRef.current = e;
            const errMsg = String(e?.message || e).toLowerCase();
            const isUnavailable = e?.name === "GroupFileUnavailableError" ||
                e instanceof GroupFileUnavailableError ||
                e?.trashed === true ||
                (isOnline && Boolean(activeGroupId) && (e?.status === 404 || errMsg.includes("404") || errMsg.includes("not found")));

            if (isUnavailable && activeGroupId) {
                console.warn(`[AutoSync] Active group ${activeGroupId} spreadsheet unavailable (trashed/deleted). Purging...`);
                try {
                    await quozen.groups.purgeUnavailableGroup(activeGroupId, undefined, (e?.trashed || errMsg.includes("trash")) ? "trashed" : "deleted");
                    await queryClient.invalidateQueries({ queryKey: ["drive", "settings"] });
                    queryClient.removeQueries({ queryKey: ["drive", "group", activeGroupId] });
                } catch (purgeErr) {
                    console.error("[AutoSync] Error purging unavailable active group:", purgeErr);
                }
                return;
            }

            // Use debug to prevent console flooding on network loss
            console.debug("[AutoSync] Polling failed (silent):", e);
            if (isOnline && isGoogle401Error(e)) {
                handleGoogleSessionExpired();
            }
        }
    }, [activeGroupId, isEnabled, syncStatus, queryClient, isOnline, handleGoogleSessionExpired]);

    // Keep the ref updated with the latest callback
    useEffect(() => {
        checkUpdatesRef.current = checkUpdates;
    }, [checkUpdates]);

    // Automatically trigger sync when transitioning to authenticated / valid token
    const prevAuthedRef = useRef<boolean>(Boolean(auth?.isAuthenticated && auth?.token));
    useEffect(() => {
        const isAuthed = Boolean(auth?.isAuthenticated && auth?.token);
        if (!prevAuthedRef.current && isAuthed) {
            void (async () => {
                if (quozen.syncProvider && !quozen.syncProvider.isInitialized()) {
                    await quozen.syncProvider.initialize();
                }
                void checkUpdatesRef.current();
            })();
        }
        prevAuthedRef.current = isAuthed;
    }, [auth?.token, auth?.isAuthenticated]);

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

        // Perform an immediate check on mount/resume only if we don't have a very recent sync (< 3s)
        const lastSync = lastSyncTimeRef.current;
        const isFresh = lastSync && (Date.now() - lastSync.getTime()) < 3000;
        if (!isFresh) {
            executeCheck();
        }

        const intervalId = setInterval(executeCheck, pollingInterval * 1000);

        return () => clearInterval(intervalId);
    }, [isPaused, isEnabled, pollingInterval]);

    // Reset ref and trigger sync when switching groups
    useEffect(() => {
        if (prevActiveGroupIdRef.current && prevActiveGroupIdRef.current !== activeGroupId) {
            lastKnownRemoteTimeRef.current = null;
            if (activeGroupId && !isPaused && isEnabled && isOnline) {
                void checkUpdatesRef.current();
            }
        }
        prevActiveGroupIdRef.current = activeGroupId;
    }, [activeGroupId, isPaused, isEnabled, isOnline]);

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
