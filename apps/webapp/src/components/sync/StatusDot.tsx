import React from "react";

export type DotState = "synced" | "syncing" | "warning" | "offline";

export interface StatusDotProps {
    state: DotState;
}

export const StatusDot: React.FC<StatusDotProps> = ({ state }) => {
    switch (state) {
        case "synced":
            return <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />;
        case "syncing":
            return <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />;
        case "warning":
            return <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />;
        case "offline":
        default:
            return <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />;
    }
};
