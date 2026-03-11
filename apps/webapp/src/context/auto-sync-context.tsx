import React, { createContext, useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { useAppContext } from "./app-context";

interface AutoSyncContextType {
    isPaused: boolean;
    setPaused: (paused: boolean) => void;
    isEnabled: boolean;
    lastSyncTime: Date | null;
    triggerSync: () => Promise<void>;
}

// Export Context so the hook can use it
export const AutoSyncContext = createContext<AutoSyncContextType | undefined>(undefined);

const UNSAFE_ROUTES = ["/add-expense", "/edit-expense", "/join"];
const DEFAULT_POLLING_INTERVAL = Number(import.meta.env.VITE_POLLING_INTERVAL || 30);

declare global {
    interface Window {
        __QUOZEN_POLLING_OVERRIDE?: number;
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
    const queryClient = useQueryClient();
    const location = useLocation();

    const [manualPaused, setManualPaused] = useState(false);
    const [routePaused, setRoutePaused] = useState(false);
    const [pageHidden, setPageHidden] = useState(document.hidden);
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

    const lastKnownRemoteTimeRef = useRef<string | null>(null);

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

    // Core Sync Logic
    const checkUpdates = useCallback(async () => {
        if (!activeGroupId || !isEnabled) return;

        try {
            // Fetch metadata only
            const remoteTimeStr = await quozen.getLastModified(activeGroupId);

            if (!lastKnownRemoteTimeRef.current) {
                // First check, initialize
                lastKnownRemoteTimeRef.current = remoteTimeStr;
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

    // 3. Polling Loop
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

    const value = useMemo(() => ({
        isPaused,
        setPaused: setManualPaused,
        isEnabled,
        lastSyncTime,
        triggerSync: checkUpdates
    }), [isPaused, isEnabled, lastSyncTime, checkUpdates]);

    return (
        <AutoSyncContext.Provider value={value}>
            {children}
        </AutoSyncContext.Provider>
    );
}
