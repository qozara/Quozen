import { useTranslation } from "react-i18next";
import { WifiOff } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface OnlineRequiredDialogProps {
  isOpen?: boolean;
  open?: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: string;
  reasonParams?: Record<string, any>;
  customMessage?: string;
}

export function OnlineRequiredDialog({
  isOpen,
  open,
  onOpenChange,
  reason,
  reasonParams,
  customMessage,
}: OnlineRequiredDialogProps) {
  const { t } = useTranslation();
  const isDialogOpen = open !== undefined ? open : (isOpen ?? false);

  return (
    <AlertDialog open={isDialogOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="online-required-dialog">
        <AlertDialogHeader className="flex flex-col items-center text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
            <WifiOff className="h-6 w-6" />
          </div>
          <AlertDialogTitle className="text-center">{t("offline.requiredTitle")}</AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {customMessage || (reason ? t(`offline.reasons.${reason}`, reasonParams) : t("offline.reasons.unhydratedGroup"))}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogAction
            data-testid="online-required-confirm"
            onClick={() => onOpenChange(false)}
          >
            {t("offline.gotIt")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default OnlineRequiredDialog;
