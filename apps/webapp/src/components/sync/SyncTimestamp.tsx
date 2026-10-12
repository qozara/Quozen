import React from "react";
import { useTranslation } from "react-i18next";

export interface SyncTimestampProps {
    lastSyncedTime?: Date | string | null;
}

export const SyncTimestamp: React.FC<SyncTimestampProps> = ({ lastSyncedTime }) => {
    const { t, i18n } = useTranslation();

    if (!lastSyncedTime) {
        return <span className="text-[11px] text-muted-foreground">{t("sync.neverSynced")}</span>;
    }

    const date = lastSyncedTime instanceof Date ? lastSyncedTime : new Date(lastSyncedTime);
    if (isNaN(date.getTime())) {
        return <span className="text-[11px] text-muted-foreground">{t("sync.neverSynced")}</span>;
    }

    const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
    let formattedTime: string;

    if (diffSeconds < 45) {
        formattedTime = t("sync.justNow");
    } else {
        formattedTime = date.toLocaleTimeString(i18n.language || undefined, {
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    return (
        <span className="text-[11px] text-muted-foreground">
            {t("sync.lastSynced", { time: formattedTime })}
        </span>
    );
};
