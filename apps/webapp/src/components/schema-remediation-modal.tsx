import { useState } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useAppContext } from "@/context/app-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function SchemaRemediationModal() {
  const { activeGroupId, schemaErrorStatus, setSchemaErrorStatus } = useAppContext();
  const [isOpen, setIsOpen] = useState(!!schemaErrorStatus);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Sync internal state when context changes
  if (!!schemaErrorStatus && !isOpen) {
    setIsOpen(true);
  } else if (!schemaErrorStatus && isOpen) {
    setIsOpen(false);
  }

  const { mutate: repair, isPending: isRepairing } = useMutation({
    mutationFn: async () => {
      if (schemaErrorStatus === 'UPGRADE_REQUIRED') {
        return apiRequest('POST', `/api/v1/groups/${activeGroupId}/migrate`);
      } else {
        return apiRequest('POST', `/api/v1/groups/${activeGroupId}/repair`);
      }
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Group schema updated successfully." });
      setSchemaErrorStatus(null);
      queryClient.invalidateQueries();
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Error", description: err.message || "Failed to fix schema." });
    }
  });

  if (!schemaErrorStatus) return null;

  return (
    <Drawer open={isOpen} onOpenChange={(o) => {
        if (!o) setSchemaErrorStatus(null);
    }}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            {schemaErrorStatus === 'UPGRADE_REQUIRED' ? 'Format Upgrade Required' : 'Group File Corrupted'}
          </DrawerTitle>
          <DrawerDescription>
            {schemaErrorStatus === 'UPGRADE_REQUIRED' 
              ? 'This group uses an older data format and needs to be upgraded before you can continue.'
              : 'We detected that required tabs or columns are missing from the group\'s Google Sheet. We can attempt to repair it.'}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button onClick={() => repair()} disabled={isRepairing}>
            {isRepairing ? "Working..." : (schemaErrorStatus === 'UPGRADE_REQUIRED' ? "Upgrade Now" : "Attempt Repair")}
          </Button>
          <Button variant="outline" onClick={() => setSchemaErrorStatus(null)}>Dismiss</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
