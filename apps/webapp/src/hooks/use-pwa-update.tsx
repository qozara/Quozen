import React, { useRef } from "react";
import { registerSW } from "virtual:pwa-register";
import { useTranslation } from "react-i18next";
import {
  PwaUpdateProvider as BasePwaUpdateProvider,
  createPwaUpdateManager,
  usePwaUpdate as useBasePwaUpdate,
  type AppUpdateCheckResult,
  type PwaUpdateManager,
} from "@qozara/pwa-update";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

export interface PwaUpdateContextValue {
  needRefresh: boolean;
  isChecking: boolean;
  isUpdating?: boolean;
  lastCheckResult?: AppUpdateCheckResult | null;
  availableVersion?: string | null;
  checkForUpdates: () => Promise<AppUpdateCheckResult | void>;
  applyUpdate: () => Promise<void>;
  dismissPrompt?: () => void;
}

export function PwaUpdateProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const managerRef = useRef<PwaUpdateManager | null>(null);
  if (!managerRef.current) {
    const version = typeof __COMMIT_HASH__ !== "undefined" ? __COMMIT_HASH__ : "dev";
    managerRef.current = createPwaUpdateManager({
      currentVersion: version,
      onUpdateAvailable: () => {
        toastRef.current({
          title: tRef.current("pwa.updateAvailableTitle"),
          description: tRef.current("pwa.updateAvailableDesc"),
          duration: 30000,
          action: (
            <ToastAction
              altText={tRef.current("pwa.reload")}
              onClick={() => void managerRef.current?.applyUpdate()}
              data-testid="button-pwa-reload"
            >
              {tRef.current("pwa.reload")}
            </ToastAction>
          ),
        });
      },
      onCheckComplete: (result) => {
        if (result === "up_to_date") {
          toastRef.current({
            title: tRef.current("pwa.upToDateTitle"),
            description: tRef.current("pwa.upToDateDesc", { version }),
          });
        } else if (result === "offline") {
          toastRef.current({
            title: tRef.current("common.error"),
            description: tRef.current("pwa.offlineCheckDesc"),
            variant: "destructive",
          });
        } else if (result === "error" || result === "timeout") {
          toastRef.current({
            title: tRef.current("common.error"),
            description: tRef.current("pwa.checkErrorDesc"),
            variant: "destructive",
          });
        }
      },
    });
  }

  return (
    <BasePwaUpdateProvider manager={managerRef.current} registerSW={registerSW}>
      {children}
    </BasePwaUpdateProvider>
  );
}

export function usePwaUpdate(): PwaUpdateContextValue {
  return useBasePwaUpdate();
}
