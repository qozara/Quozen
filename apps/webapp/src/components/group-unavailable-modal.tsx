import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAppContext } from "@/context/app-context";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export interface GroupUnavailableDetail {
  groupId: string;
  groupName: string;
  reason?: "trashed" | "deleted";
  fallbackGroupId?: string | null;
  hasRemainingGroups?: boolean;
}

export default function GroupUnavailableModal() {
  const [detail, setDetail] = useState<GroupUnavailableDetail | null>(null);
  const { activeGroupId, setActiveGroupId } = useAppContext();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    const handleUnavailable = (e: any) => {
      const data = e.detail as GroupUnavailableDetail;
      if (data && data.groupId) {
        setDetail(data);
      }
    };

    window.addEventListener("group-file-unavailable", handleUnavailable);
    return () => window.removeEventListener("group-file-unavailable", handleUnavailable);
  }, []);

  const handleConfirm = () => {
    if (!detail) return;
    const currentDetail = detail;
    setDetail(null);

    void queryClient.invalidateQueries({ queryKey: ["drive", "settings"] });
    queryClient.removeQueries({ queryKey: ["drive", "group", currentDetail.groupId] });

    if (activeGroupId === currentDetail.groupId) {
      if (currentDetail.fallbackGroupId) {
        setActiveGroupId(currentDetail.fallbackGroupId);
      } else {
        setActiveGroupId("");
        navigate("/groups");
      }
    }
  };

  if (!detail) return null;

  return (
    <AlertDialog open={!!detail} onOpenChange={(open) => !open && handleConfirm()}>
      <AlertDialogContent data-testid="group-unavailable-modal">
        <AlertDialogHeader>
          <AlertDialogTitle data-testid="group-unavailable-title">
            {t("groups.fileUnavailableTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription data-testid="group-unavailable-description">
            {t("groups.fileUnavailableDesc", { name: detail.groupName || "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={handleConfirm} data-testid="group-unavailable-confirm">
            {t("common.ok") || "OK"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
