import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { SyncGlyph } from "./SyncGlyph";
import { SyncInspectorPopover } from "./SyncInspectorPopover";

export const SyncTrigger: React.FC = () => {
    const { t } = useTranslation();
    const autoSync = useAutoSync();
    const uxSyncState = autoSync?.uxSyncState ?? "hidden";
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    if (uxSyncState === "hidden") {
        return null;
    }

    const badgeBorderColor =
        uxSyncState === "warning"
            ? "border-amber-500/50 bg-amber-500/10"
            : uxSyncState === "offline"
              ? "border-border bg-muted/90"
              : "border-border/80 bg-card/90";

    return (
        <div
            ref={containerRef}
            className="fixed bottom-20 right-4 z-40 flex flex-col items-end"
            data-testid="sync-status-widget"
        >
            {isOpen && (
                <div className="mb-2">
                    <SyncInspectorPopover onClose={() => setIsOpen(false)} />
                </div>
            )}

            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
                aria-label={t(`sync.states.${uxSyncState}`)}
                aria-expanded={isOpen}
                title={t(`sync.states.${uxSyncState}`)}
                data-testid="button-sync-status-trigger"
                className={`h-10 w-10 rounded-full shadow-lg backdrop-blur-md border flex items-center justify-center transition-all hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/30 ${badgeBorderColor}`}
            >
                <SyncGlyph state={uxSyncState} />
            </button>
        </div>
    );
};
