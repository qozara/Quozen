import { describe, it, expect } from "vitest";
import { resolveUXStatus, resolveProviderDiagnostic } from "../../src/sync/evaluator";

describe("Sync Evaluator (resolveUXStatus & resolveProviderDiagnostic)", () => {
    it("returns 'hidden' when providerConnected is false or status is disconnected", () => {
        expect(resolveUXStatus({ isOnline: true, providerConnected: false, providerStatus: "idle" })).toBe("hidden");
        expect(resolveUXStatus({ isOnline: true, providerConnected: true, providerStatus: "disconnected" })).toBe("hidden");
    });

    it("returns 'offline' when isOnline is false and provider is connected", () => {
        expect(resolveUXStatus({ isOnline: false, providerConnected: true, providerStatus: "idle" })).toBe("offline");
        expect(resolveUXStatus({ isOnline: false, providerConnected: true, providerStatus: "syncing" })).toBe("offline");
    });

    it("returns 'syncing' when providerStatus is 'syncing' and online", () => {
        expect(resolveUXStatus({ isOnline: true, providerConnected: true, providerStatus: "syncing" })).toBe("syncing");
    });

    it("returns 'warning' when providerStatus is auth_failed, throttled, error, corrupted, or upgrade_required", () => {
        expect(resolveUXStatus({ isOnline: true, providerConnected: true, providerStatus: "auth_failed" })).toBe("warning");
        expect(resolveUXStatus({ isOnline: true, providerConnected: true, providerStatus: "throttled" })).toBe("warning");
        expect(resolveUXStatus({ isOnline: true, providerConnected: true, providerStatus: "error" })).toBe("warning");
        expect(resolveUXStatus({ isOnline: true, providerConnected: true, providerStatus: "corrupted" })).toBe("warning");
        expect(resolveUXStatus({ isOnline: true, providerConnected: true, providerStatus: "upgrade_required" })).toBe("warning");
    });

    it("returns 'synced' when providerStatus is 'idle' or 'synced' and online", () => {
        expect(resolveUXStatus({ isOnline: true, providerConnected: true, providerStatus: "idle" })).toBe("synced");
        expect(resolveUXStatus({ isOnline: true, providerConnected: true, providerStatus: "synced" })).toBe("synced");
    });

    it("resolveProviderDiagnostic returns expected diagnostic keys", () => {
        expect(resolveProviderDiagnostic(true, false, "idle")).toBe("disconnected");
        expect(resolveProviderDiagnostic(true, true, "disconnected")).toBe("disconnected");
        expect(resolveProviderDiagnostic(false, true, "idle")).toBe("offline");
        expect(resolveProviderDiagnostic(true, true, "syncing")).toBe("syncing");
        expect(resolveProviderDiagnostic(true, true, "auth_failed")).toBe("auth_failed");
        expect(resolveProviderDiagnostic(true, true, "throttled")).toBe("throttled");
        expect(resolveProviderDiagnostic(true, true, "corrupted")).toBe("corrupted");
        expect(resolveProviderDiagnostic(true, true, "upgrade_required")).toBe("upgrade_required");
        expect(resolveProviderDiagnostic(true, true, "error")).toBe("error");
        expect(resolveProviderDiagnostic(true, true, "idle")).toBe("synced");
        expect(resolveProviderDiagnostic(true, true, "synced")).toBe("synced");
    });
});
