import React from "react";

export type DotState = "idle" | "syncing" | "waiting" | "error" | "offline" | "local";

export interface StatusDotProps {
    state: DotState;
}

export const StatusDot: React.FC<StatusDotProps> = ({ state }) => {
    switch (state) {
        case "idle":
            return <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />;
        case "syncing":
            return <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />;
        case "waiting":
        case "error":
            return <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />;
        case "offline":
        case "local":
        default:
            return <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />;
    }
};
