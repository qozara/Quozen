import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { SyncGlyph } from "./SyncGlyph";
import { SyncInspectorPopover } from "./SyncInspectorPopover";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

export const SyncTrigger: React.FC = () => {
    const { t } = useTranslation();
    const autoSync = useAutoSync();
    const uxSyncState = autoSync?.uxSyncState ?? "hidden";
    const [isOpen, setIsOpen] = useState(false);

    if (uxSyncState === "hidden") {
        return null;
    }

    const badgeBorderColor =
        uxSyncState === "warning"
            ? "border-amber-500/50 bg-amber-500/10"
            : uxSyncState === "offline"
              ? "border-border bg-muted"
              : "border-border/80 bg-muted/60 hover:bg-accent";

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <div
                className="relative flex items-center"
                data-testid="sync-status-widget"
            >
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        aria-label={t(`sync.states.${uxSyncState}`)}
                        aria-expanded={isOpen}
                        title={t(`sync.states.${uxSyncState}`)}
                        data-testid="button-sync-status-trigger"
                        className={`h-8 w-8 rounded-full border flex items-center justify-center transition-all hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/30 ${badgeBorderColor}`}
                    >
                        <SyncGlyph state={uxSyncState} />
                    </button>
                </PopoverTrigger>

                <PopoverContent
                    align="end"
                    sideOffset={8}
                    className="p-0 border-none bg-transparent shadow-none w-auto z-[100]"
                >
                    <SyncInspectorPopover onClose={() => setIsOpen(false)} />
                </PopoverContent>
            </div>
        </Popover>
    );
};
