import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { AutoSyncProvider } from "@/context/auto-sync-context";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { useAppContext } from "@/context/app-context";
import { useOptionalAuth } from "@/context/auth-provider";
import { useToast } from "@/hooks/use-toast";
import { quozen } from "@/lib/storage";

const mockNavigate = vi.fn();
const mockLocation = { pathname: "/dashboard", search: "", hash: "", state: null, key: "default" };

vi.mock("react-router-dom", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react-router-dom")>();
    return {
        ...actual,
        useNavigate: () => mockNavigate,
        useLocation: () => mockLocation,
    };
});

vi.mock("@/context/app-context", () => ({
    useAppContext: vi.fn(),
}));

vi.mock("@/context/auth-provider", () => ({
    useOptionalAuth: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
    useToast: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
    useQueryClient: () => ({
        invalidateQueries: vi.fn(),
    }),
}));

vi.mock("@/lib/storage", () => ({
    quozen: {
        getLastModified: vi.fn(),
        syncProvider: null,
        replication: null,
    },
}));

describe("AutoSync Google Session Expiration (401)", () => {
    const mockToast = vi.fn();
    const mockLogout = vi.fn();
    let statusListener: ((status: string, error?: any) => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        (useAppContext as any).mockReturnValue({ activeGroupId: "group-1" });
        (useToast as any).mockReturnValue({ toast: mockToast });
        (useOptionalAuth as any).mockReturnValue({
            isAuthenticated: true,
            logout: mockLogout,
            login: vi.fn(),
        });

        statusListener = null;
        (quozen as any).syncProvider = {
            getStatus: () => "idle",
            isInitialized: () => true,
            getLastSyncedTime: () => new Date().toISOString(),
            onStatusChange: (listener: any) => {
                statusListener = listener;
                return () => {
                    statusListener = null;
                };
            },
            getLastError: () => null,
        };

        (quozen.getLastModified as any).mockResolvedValue("2023-01-01T12:00:00Z");
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AutoSyncProvider pollingInterval={10}>{children}</AutoSyncProvider>
    );

    it("navigates to /login and logs out without showing toast when online and background sync detects 401 session expired", async () => {
        renderHook(() => useAutoSync(), { wrapper });

        expect(statusListener).toBeDefined();

        const error401 = new Error("Google Auth Failed (401) during sync. Details: Invalid Credentials");
        (error401 as any).status = 401;
        (quozen as any).syncProvider.getLastError = () => error401;

        await act(async () => {
            statusListener?.("auth_failed", error401);
        });

        // Should NOT show toast error message
        expect(mockToast).not.toHaveBeenCalled();

        // Should log out to allow Login page to show welcome and sign-in button
        expect(mockLogout).toHaveBeenCalledTimes(1);

        // Should navigate to /login preserving from location
        expect(mockNavigate).toHaveBeenCalledWith("/login", {
            state: { from: mockLocation },
        });
    });

    it("shows toast and does NOT navigate or logout when auth_failed is caused by 403 (non-401)", async () => {
        renderHook(() => useAutoSync(), { wrapper });

        expect(statusListener).toBeDefined();

        const error403 = new Error("Google Auth Failed (403) during sync. Details: Forbidden");
        (error403 as any).status = 403;
        (quozen as any).syncProvider.getLastError = () => error403;

        await act(async () => {
            statusListener?.("auth_failed", error403);
        });

        // Should show the toast error message
        expect(mockToast).toHaveBeenCalledWith(
            expect.objectContaining({
                variant: "destructive",
            })
        );

        // Should NOT log out
        expect(mockLogout).not.toHaveBeenCalled();

        // Should NOT navigate to /login
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("does NOT navigate to /login or logout if the app is offline when 401 occurs", async () => {
        // Simulate offline
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

        renderHook(() => useAutoSync(), { wrapper });

        const error401 = new Error("Google Auth Failed (401) during sync");
        (error401 as any).status = 401;
        (quozen as any).syncProvider.getLastError = () => error401;

        await act(async () => {
            statusListener?.("auth_failed", error401);
        });

        expect(mockLogout).not.toHaveBeenCalled();
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("navigates to /login and logs out when checkUpdates directly encounters a 401 error while online", async () => {
        const error401 = new Error("Session expired (401). Please reload to sign in again.");
        (error401 as any).status = 401;
        (quozen.getLastModified as any).mockRejectedValue(error401);

        renderHook(() => useAutoSync(), { wrapper });

        await act(async () => {
            await Promise.resolve();
        });

        expect(mockToast).not.toHaveBeenCalled();
        expect(mockLogout).toHaveBeenCalledTimes(1);
        expect(mockNavigate).toHaveBeenCalledWith("/login", {
            state: { from: mockLocation },
        });
    });
});
