import React from "react";
import { StatusDot, type DotState } from "./StatusDot";

export interface DiagnosticRowProps {
    label: string;
    detail: string;
    state: DotState;
    action?: React.ReactNode;
}

export const DiagnosticRow: React.FC<DiagnosticRowProps> = ({
    label,
    detail,
    state,
    action
}) => {
    return (
        <div className="py-2">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                    <div className="mt-1.5">
                        <StatusDot state={state} />
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{label}</p>
                        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                            {detail}
                        </p>
                    </div>
                </div>
            </div>
            {action && <div className="mt-2.5 pl-4">{action}</div>}
        </div>
    );
};
