import type { CloudSyncProvider, SyncStatus, UXSyncState } from "./types";

export interface ResolveUXStatusParams {
    isOnline: boolean;
    providerConnected?: boolean;
    providerStatus?: SyncStatus;
    adapter?: CloudSyncProvider | { getStatus(): SyncStatus } | null;
    adapterStatus?: SyncStatus;
}

export type ProviderDiagnosticKey =
    | "synced"
    | "syncing"
    | "offline"
    | "auth_failed"
    | "throttled"
    | "corrupted"
    | "upgrade_required"
    | "incompatible"
    | "error"
    | "disconnected";

/**
 * Pure State Evaluator function mapping low-level network and sync adapter states
 * into a unified UX presentation state:
 *
 * - Sync in progress                                      --> 'syncing'
 * - Device Offline                                        --> 'offline'
 * - Auth Revoked / Rate Limit / Error / Schema Remediation --> 'warning'
 * - All clean & synced                                    --> 'synced'
 * - No adapter configured / disconnected                  --> 'hidden'
 */
export function resolveUXStatus(params: ResolveUXStatusParams): UXSyncState {
    const { isOnline, adapter } = params;
    const isConnected =
        params.providerConnected !== undefined
            ? params.providerConnected
            : adapter !== null && adapter !== undefined;

    const status: SyncStatus =
        params.providerStatus !== undefined
            ? params.providerStatus
            : params.adapterStatus !== undefined
              ? params.adapterStatus
              : adapter
                ? adapter.getStatus()
                : "disconnected";

    // No adapter configured or disconnected
    if (!isConnected || status === "disconnected") {
        return "hidden";
    }

    // Device Offline takes precedence over adapter syncing/idle
    if (!isOnline) {
        return "offline";
    }

    // Active sync in progress
    if (status === "syncing") {
        return "syncing";
    }

    // Auth Revoked / Rate Limit / Persistent Error / Schema Remediation Needed
    if (
        status === "auth_failed" ||
        status === "throttled" ||
        status === "error" ||
        status === "corrupted" ||
        status === "upgrade_required" ||
        status === "incompatible"
    ) {
        return "warning";
    }

    // All clean & synced
    if (status === "idle" || status === "synced") {
        return "synced";
    }

    return "hidden";
}

/**
 * Resolves the diagnostic localization key for a cloud provider (`sync.diagnostics.*`).
 */
export function resolveProviderDiagnostic(
    isOnline: boolean,
    providerConnected: boolean,
    providerStatus: SyncStatus
): ProviderDiagnosticKey {
    if (!providerConnected || providerStatus === "disconnected") {
        return "disconnected";
    }
    if (!isOnline) {
        return "offline";
    }
    if (providerStatus === "syncing") {
        return "syncing";
    }
    if (
        providerStatus === "auth_failed" ||
        providerStatus === "throttled" ||
        providerStatus === "corrupted" ||
        providerStatus === "upgrade_required" ||
        providerStatus === "incompatible" ||
        providerStatus === "error"
    ) {
        return providerStatus;
    }
    return "synced";
}
