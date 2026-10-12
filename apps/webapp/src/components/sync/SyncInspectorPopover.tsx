import React, { useState } from "react";
import { RefreshCw, LogIn, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveProviderDiagnostic } from "@quozen/core";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { useAppContext } from "@/context/app-context";
import { DiagnosticRow } from "./DiagnosticRow";
import { SyncTimestamp } from "./SyncTimestamp";
import type { DotState } from "./StatusDot";

export interface SyncInspectorPopoverProps {
    onClose?: () => void;
}

export const SyncInspectorPopover: React.FC<SyncInspectorPopoverProps> = ({ onClose }) => {
    const { t } = useTranslation();
    const {
        isOnline,
        syncStatus,
        uxSyncState,
        lastSyncTime,
        triggerSync,
        reconnectProvider
    } = useAutoSync();
    const { setSchemaErrorStatus } = useAppContext();

    const [isForcingSync, setIsForcingSync] = useState(false);

    const diagKey = resolveProviderDiagnostic(isOnline, true, syncStatus);
    const dotState: DotState =
        uxSyncState === "hidden" ? "offline" : uxSyncState;

    const handleForceSync = async () => {
        if (!isOnline || isForcingSync || syncStatus === "syncing") return;
        setIsForcingSync(true);
        try {
            await triggerSync();
        } finally {
            setIsForcingSync(false);
        }
    };

    const handleReconnect = async () => {
        await reconnectProvider();
        onClose?.();
    };

    const handleOpenSchemaRemediation = () => {
        if (syncStatus === "corrupted") {
            setSchemaErrorStatus("CORRUPTED");
        } else if (syncStatus === "upgrade_required") {
            setSchemaErrorStatus("UPGRADE_REQUIRED");
        }
        onClose?.();
    };

    return (
        <div
            className="w-72 rounded-2xl bg-popover/95 backdrop-blur-xl shadow-xl border border-border p-4 z-50 text-popover-foreground"
            role="dialog"
            aria-label={t("sync.title")}
            data-testid="sync-inspector-popover"
        >
            <div className="pb-2.5 mb-2 border-b border-border/60 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {t("sync.title")}
                </h3>
                <SyncTimestamp lastSyncedTime={lastSyncTime} />
            </div>

            <DiagnosticRow
                label={t("sync.providerName")}
                detail={t(`sync.diagnostics.${diagKey}`)}
                state={dotState}
                action={
                    <div className="flex flex-col gap-2">
                        {syncStatus === "auth_failed" && (
                            <button
                                type="button"
                                onClick={handleReconnect}
                                data-testid="button-sync-reconnect"
                                className="w-full py-1.5 px-3 bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                            >
                                <LogIn className="w-3.5 h-3.5" />
                                {t("sync.reconnect")}
                            </button>
                        )}

                        {(syncStatus === "corrupted" || syncStatus === "upgrade_required") && (
                            <button
                                type="button"
                                onClick={handleOpenSchemaRemediation}
                                data-testid="button-sync-remediate"
                                className="w-full py-1.5 px-3 bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                            >
                                <Wrench className="w-3.5 h-3.5" />
                                {syncStatus === "corrupted"
                                    ? t("schemaRemediation.attemptRepair")
                                    : t("schemaRemediation.upgradeNow")}
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={handleForceSync}
                            disabled={!isOnline || isForcingSync || syncStatus === "syncing"}
                            data-testid="button-force-sync"
                            className="w-full py-1.5 px-3 bg-secondary hover:bg-secondary/80 disabled:opacity-50 text-secondary-foreground rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                        >
                            <RefreshCw
                                className={`w-3.5 h-3.5 ${
                                    isForcingSync || syncStatus === "syncing" ? "animate-spin" : ""
                                }`}
                            />
                            {isForcingSync || syncStatus === "syncing"
                                ? t("sync.syncingNow")
                                : t("sync.forceSync")}
                        </button>
                    </div>
                }
            />
        </div>
    );
};
