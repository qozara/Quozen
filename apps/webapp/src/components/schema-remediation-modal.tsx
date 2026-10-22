import { useState, useEffect } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useAppContext } from "@/context/app-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

export default function SchemaRemediationModal() {
  const { activeGroupId, schemaErrorStatus, setSchemaErrorStatus } = useAppContext();
  const [isOpen, setIsOpen] = useState(!!schemaErrorStatus);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

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
      queryClient.invalidateQueries();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: t("common.error"), description: err.message || t("schemaRemediation.errorDesc") });
    }
  });

  // Auto-upgrade on group open when migration is required
  useEffect(() => {
    if (schemaErrorStatus === 'UPGRADE_REQUIRED' && activeGroupId && !isRepairing) {
      repair();
    }
  }, [schemaErrorStatus, activeGroupId]);

  if (!schemaErrorStatus) return null;

  return (
    <Drawer open={isOpen} onOpenChange={(o) => {
        if (!o) setSchemaErrorStatus(null);
    }}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            {schemaErrorStatus === 'UPGRADE_REQUIRED' ? t("schemaRemediation.upgradeRequiredTitle") : t("schemaRemediation.corruptedTitle")}
          </DrawerTitle>
          <DrawerDescription>
            {schemaErrorStatus === 'UPGRADE_REQUIRED' 
              ? t("schemaRemediation.upgradeRequiredDesc")
              : t("schemaRemediation.corruptedDesc")}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button onClick={() => repair()} disabled={isRepairing}>
            {isRepairing ? t("schemaRemediation.working") : (schemaErrorStatus === 'UPGRADE_REQUIRED' ? t("schemaRemediation.upgradeNow") : t("schemaRemediation.attemptRepair"))}
          </Button>
          <Button variant="outline" onClick={() => setSchemaErrorStatus(null)}>{t("schemaRemediation.dismiss")}</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
