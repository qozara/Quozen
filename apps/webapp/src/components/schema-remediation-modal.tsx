import { useState, useEffect, useRef } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useAppContext } from "@/context/app-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { destroyQuozenDatabase } from "@quozen/core";

export default function SchemaRemediationModal() {
  const { activeGroupId, schemaErrorStatus, setSchemaErrorStatus } = useAppContext();
  const [isOpen, setIsOpen] = useState(!!schemaErrorStatus);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const hasTriggeredRef = useRef(false);

  // Sync internal state when context changes
  if (!!schemaErrorStatus && !isOpen) {
    setIsOpen(true);
  } else if (!schemaErrorStatus && isOpen) {
    setIsOpen(false);
  }

  const { mutate: repair, isPending: isRepairing } = useMutation({
    mutationFn: async () => {
      if (!activeGroupId) throw new Error("No active group");
      if (schemaErrorStatus === 'UPGRADE_REQUIRED') {
        return quozen.ledger(activeGroupId).migrateSchema();
      } else {
        return quozen.ledger(activeGroupId).repairSchema();
      }
    },
    onSuccess: () => {
      toast({ title: t("common.success"), description: t("schemaRemediation.successDesc") });
      setSchemaErrorStatus(null);
      hasTriggeredRef.current = false;
      if (quozen.syncProvider && typeof (quozen.syncProvider as any).setStatus === "function") {
        (quozen.syncProvider as any).setStatus("idle");
      }
      if (quozen.replication && activeGroupId) {
        void quozen.replication.sync(activeGroupId).catch(() => {});
      }
      void queryClient.invalidateQueries({ queryKey: ["drive", "settings"] });
      if (activeGroupId) {
        void queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
      }
    },
    onError: (err: any) => {
      hasTriggeredRef.current = false;
      toast({ variant: "destructive", title: t("common.error"), description: err.message || t("schemaRemediation.errorDesc") });
    }
  });

  const handleRefresh = async () => {
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const r of registrations) {
          await r.update();
        }
      } catch {
        // ignore
      }
    }
    window.location.reload();
  };

  const handleResetApp = async () => {
    try {
      if (quozen.db) {
        await destroyQuozenDatabase(quozen.db);
      }
      localStorage.clear();
      sessionStorage.clear();
      if ('caches' in window) {
        const cacheKeys = await caches.keys();
        for (const key of cacheKeys) {
          await caches.delete(key);
        }
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const r of registrations) {
          await r.unregister();
        }
      }
    } catch (err) {
      console.warn("Reset app error:", err);
    } finally {
      window.location.href = '/login';
    }
  };

  // Auto-upgrade on group open when migration is required
  useEffect(() => {
    if (schemaErrorStatus === 'UPGRADE_REQUIRED' && activeGroupId && !isRepairing && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      repair();
    }
    if (!schemaErrorStatus) {
      hasTriggeredRef.current = false;
    }
  }, [schemaErrorStatus, activeGroupId, isRepairing]);

  if (!schemaErrorStatus) return null;

  return (
    <Drawer open={isOpen} onOpenChange={(o) => {
        if (!o && !isRepairing) setSchemaErrorStatus(null);
    }}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            {schemaErrorStatus === 'UPGRADE_REQUIRED' 
              ? t("schemaRemediation.upgradeRequiredTitle") 
              : schemaErrorStatus === 'INCOMPATIBLE'
                ? t("schemaRemediation.incompatibleTitle")
                : t("schemaRemediation.corruptedTitle")}
          </DrawerTitle>
          <DrawerDescription>
            {schemaErrorStatus === 'UPGRADE_REQUIRED' 
              ? t("schemaRemediation.upgradeRequiredDesc")
              : schemaErrorStatus === 'INCOMPATIBLE'
                ? t("schemaRemediation.incompatibleDesc")
                : t("schemaRemediation.corruptedDesc")}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          {schemaErrorStatus === 'INCOMPATIBLE' ? (
            <>
              <Button onClick={handleRefresh}>
                {t("schemaRemediation.refreshApp")}
              </Button>
              <Button variant="destructive" onClick={handleResetApp}>
                {t("schemaRemediation.resetApp")}
              </Button>
              <Button variant="outline" onClick={() => setSchemaErrorStatus(null)}>
                {t("schemaRemediation.dismiss")}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => { if (!isRepairing) repair(); }} disabled={isRepairing}>
                {isRepairing ? t("schemaRemediation.working") : (schemaErrorStatus === 'UPGRADE_REQUIRED' ? t("schemaRemediation.upgradeNow") : t("schemaRemediation.attemptRepair"))}
              </Button>
              <Button variant="outline" onClick={() => setSchemaErrorStatus(null)} disabled={isRepairing}>
                {t("schemaRemediation.dismiss")}
              </Button>
            </>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
