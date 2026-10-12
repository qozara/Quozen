import React from "react";
import { Loader2, CloudOff, AlertCircle, CheckCircle2 } from "lucide-react";
import type { UXSyncState } from "@quozen/core";

export interface SyncGlyphProps {
    state: UXSyncState;
    className?: string;
}

export const SyncGlyph: React.FC<SyncGlyphProps> = ({ state, className = "w-4 h-4" }) => {
    switch (state) {
        case "syncing":
            return <Loader2 className={`${className} text-primary animate-spin`} aria-hidden="true" />;
        case "offline":
            return <CloudOff className={`${className} text-muted-foreground`} aria-hidden="true" />;
        case "warning":
            return (
                <span className="relative inline-flex items-center justify-center">
                    <AlertCircle className={`${className} text-amber-500`} aria-hidden="true" />
                    <span
                        className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full animate-pulse"
                        aria-hidden="true"
                    />
                </span>
            );
        case "synced":
            return <CheckCircle2 className={`${className} text-emerald-500`} aria-hidden="true" />;
        case "hidden":
        default:
            return null;
    }
};
