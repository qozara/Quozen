import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { registerSW } from "virtual:pwa-register";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

const UPDATE_CHECK_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

export interface PwaUpdateContextValue {
  needRefresh: boolean;
  isChecking: boolean;
  checkForUpdates: () => Promise<void>;
  applyUpdate: () => Promise<void>;
}

const defaultContextValue: PwaUpdateContextValue = {
  needRefresh: false,
  isChecking: false,
  checkForUpdates: async () => {},
  applyUpdate: async () => {},
};

const PwaUpdateContext = createContext<PwaUpdateContextValue>(defaultContextValue);

export function PwaUpdateProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [needRefresh, setNeedRefresh] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const updateSwRef = useRef<((reloadPage?: boolean) => Promise<void>) | undefined>(undefined);
  const lastCheckRef = useRef<number>(Date.now());
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const applyUpdate = useCallback(async () => {
    let reloaded = false;
    const reload = () => {
      if (!reloaded) {
        reloaded = true;
        window.location.reload();
      }
    };

    // 1. Listen for native controllerchange so as soon as new SW activates, we reload
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
    }

    try {
      // 2. Post SKIP_WAITING to waiting service worker if available
      let reg = registrationRef.current;
      if (!reg && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        reg = await navigator.serviceWorker.getRegistration();
        registrationRef.current = reg;
      }

      if (reg?.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      // 3. Call vite-plugin-pwa updateSW callback if registered
      if (updateSwRef.current) {
        await updateSwRef.current(true);
      }
    } catch (e) {
      console.warn("[PWA] Error applying update:", e);
    }

    // 4. Fallback timeout: If controllerchange has not fired after 500ms, force reload
    setTimeout(reload, 500);
  }, []);

  const showUpdateToast = useCallback(() => {
    setNeedRefresh(true);
    toastRef.current({
      title: tRef.current("pwa.updateAvailableTitle"),
      description: tRef.current("pwa.updateAvailableDesc"),
      duration: 30000,
      action: (
        <ToastAction
          altText={tRef.current("pwa.reload")}
          onClick={() => void applyUpdate()}
          data-testid="button-pwa-reload"
        >
          {tRef.current("pwa.reload")}
        </ToastAction>
      ),
    });
  }, [applyUpdate]);

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        showUpdateToast();
      },
      onRegisteredSW(_swUrl, registration) {
        registrationRef.current = registration;
        lastCheckRef.current = Date.now();
      },
    });
    updateSwRef.current = updateSW;
  }, [showUpdateToast]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        (typeof navigator === "undefined" || navigator.onLine !== false)
      ) {
        const now = Date.now();
        if (now - lastCheckRef.current >= UPDATE_CHECK_COOLDOWN_MS) {
          lastCheckRef.current = now;
          void registrationRef.current?.update()?.catch(() => {});
        }
      }
    };

    const handlePreloadError = () => {
      window.location.reload();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("vite:preloadError", handlePreloadError);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("vite:preloadError", handlePreloadError);
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toastRef.current({
        title: tRef.current("common.error"),
        description: tRef.current("pwa.offlineCheckDesc"),
        variant: "destructive",
      });
      return;
    }

    if (needRefresh || registrationRef.current?.waiting) {
      showUpdateToast();
      return;
    }

    setIsChecking(true);
    try {
      let reg = registrationRef.current;
      if (!reg && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        reg = await navigator.serviceWorker.getRegistration();
        registrationRef.current = reg;
      }

      if (reg) {
        lastCheckRef.current = Date.now();
        await reg.update();

        if (reg.waiting) {
          showUpdateToast();
          return;
        }

        if (reg.installing) {
          const installingWorker = reg.installing;
          const installed = await new Promise<boolean>((resolve) => {
            const onStateChange = () => {
              if (installingWorker.state === "installed") {
                installingWorker.removeEventListener("statechange", onStateChange);
                resolve(true);
              } else if (
                installingWorker.state === "redundant" ||
                installingWorker.state === "activated"
              ) {
                installingWorker.removeEventListener("statechange", onStateChange);
                resolve(false);
              }
            };
            installingWorker.addEventListener("statechange", onStateChange);
          });

          if (installed) {
            showUpdateToast();
            return;
          }
        }
      }

      toastRef.current({
        title: tRef.current("pwa.upToDateTitle"),
        description: tRef.current("pwa.upToDateDesc", { version: __COMMIT_HASH__ }),
      });
    } catch {
      toastRef.current({
        title: tRef.current("pwa.upToDateTitle"),
        description: tRef.current("pwa.upToDateDesc", { version: __COMMIT_HASH__ }),
      });
    } finally {
      setIsChecking(false);
    }
  }, [needRefresh, showUpdateToast]);

  return (
    <PwaUpdateContext.Provider
      value={{
        needRefresh,
        isChecking,
        checkForUpdates,
        applyUpdate,
      }}
    >
      {children}
    </PwaUpdateContext.Provider>
  );
}

export function usePwaUpdate(): PwaUpdateContextValue {
  return useContext(PwaUpdateContext);
}
