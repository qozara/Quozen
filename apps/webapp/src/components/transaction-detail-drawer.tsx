import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CategoryBadge, CategoryIconBadge } from "@/components/category-icon";
import {
  Expense,
  Settlement,
  Member,
  ExpenseCategory,
  formatCurrency,
} from "@quozen/core";
import { ArrowRight, Calendar, CreditCard, FileText, Handshake, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { useSettings } from "@/hooks/use-settings";

export type TransactionDetailItem =
  | { type: "expense"; data: Expense }
  | { type: "settlement"; data: Settlement };

interface TransactionDetailDrawerProps {
  item: TransactionDetailItem | null;
  onClose: () => void;
  members: Member[];
  categories?: ExpenseCategory[];
}

export default function TransactionDetailDrawer({
  item,
  onClose,
  members,
  categories,
}: TransactionDetailDrawerProps) {
  const { t, i18n } = useTranslation();
  const { formatDate } = useDateFormatter();
  const { settings } = useSettings();
  const currencyCode = settings?.preferences?.defaultCurrency || "USD";

  const getMemberName = (userId: string) =>
    members.find((m) => m.userId === userId)?.name || "Unknown";

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();

  return (
    <Drawer open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent data-testid="drawer-transaction-detail">
        {item?.type === "expense" && (
          <>
            <DrawerHeader className="text-left">
              <div className="flex items-center gap-3">
                <CategoryIconBadge
                  categoryId={item.data.category}
                  categories={categories}
                  size="lg"
                  shape="rounded"
                />
                <div className="min-w-0 flex-1">
                  <DrawerTitle className="truncate text-lg">
                    {item.data.description}
                  </DrawerTitle>
                  <DrawerDescription className="mt-0.5 flex items-center gap-1.5 text-xs">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{formatDate(item.data.date)}</span>
                  </DrawerDescription>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-foreground">
                    {formatCurrency(Number(item.data.amount), currencyCode, i18n.language)}
                  </div>
                </div>
              </div>
            </DrawerHeader>

            <div className="px-4 pb-4 space-y-4 overflow-y-auto max-h-[60vh]">
              <div className="flex items-center justify-between py-2 border-y border-border text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <User className="w-4 h-4" />
                  {t("expenseForm.paidBy")}
                </span>
                <span className="font-medium text-foreground">
                  {getMemberName(item.data.paidByUserId)}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("expenseForm.category")}</span>
                <CategoryBadge
                  categoryId={item.data.category}
                  categories={categories}
                  showIcon
                />
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("transactionDetail.splitsTitle", "Split Breakdown")}
                </h4>
                <div className="divide-y divide-border rounded-lg border border-border bg-muted/20">
                  {(item.data.splits || [])
                    .filter((s) => Number(s.amount) > 0)
                    .map((split) => {
                      const name = getMemberName(split.userId);
                      return (
                        <div
                          key={split.userId}
                          className="flex items-center justify-between px-3 py-2.5 text-sm"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar className="w-7 h-7 border border-border">
                              <AvatarFallback className="text-[10px]">
                                {getInitials(name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate font-medium text-foreground">
                              {name}
                            </span>
                          </div>
                          <span className="font-semibold text-foreground shrink-0">
                            {formatCurrency(Number(split.amount), currencyCode, i18n.language)}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </>
        )}

        {item?.type === "settlement" && (
          <>
            <DrawerHeader className="text-center">
              <div className="w-12 h-12 rounded-full bg-secondary/60 border border-border flex items-center justify-center mx-auto mb-2">
                <Handshake className="w-6 h-6 text-primary" />
              </div>
              <DrawerTitle>
                {formatCurrency(Number(item.data.amount), currencyCode, i18n.language)}
              </DrawerTitle>
              <DrawerDescription className="flex items-center justify-center gap-1.5 text-xs">
                <Calendar className="w-3.5 h-3.5" />
                <span>{formatDate(item.data.date)}</span>
              </DrawerDescription>
            </DrawerHeader>

            <div className="px-4 pb-4 space-y-4 overflow-y-auto max-h-[60vh]">
              <div className="flex items-center justify-around py-4 px-3 rounded-xl bg-muted/30 border border-border">
                <div className="flex flex-col items-center gap-1.5 max-w-[110px]">
                  <Avatar className="w-11 h-11 border border-border">
                    <AvatarFallback className="text-xs font-semibold">
                      {getInitials(getMemberName(item.data.fromUserId))}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-medium truncate max-w-full">
                    {getMemberName(item.data.fromUserId)}
                  </span>
                </div>

                <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" />

                <div className="flex flex-col items-center gap-1.5 max-w-[110px]">
                  <Avatar className="w-11 h-11 border border-border">
                    <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                      {getInitials(getMemberName(item.data.toUserId))}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-medium truncate max-w-full">
                    {getMemberName(item.data.toUserId)}
                  </span>
                </div>
              </div>

              <div className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <CreditCard className="w-4 h-4" />
                    {t("settlement.method")}
                  </span>
                  <span className="font-medium capitalize text-foreground">
                    {(item.data.method || "cash").replace("_", " ")}
                  </span>
                </div>

                {item.data.notes && (
                  <div className="space-y-1 pt-1">
                    <span className="text-muted-foreground flex items-center gap-2 text-xs">
                      <FileText className="w-3.5 h-3.5" />
                      {t("settlement.notes")}
                    </span>
                    <p className="text-sm text-foreground bg-muted/20 rounded-lg p-3 border border-border">
                      {item.data.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <DrawerFooter className="border-t border-border bg-background">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={onClose}
            data-testid="button-close-transaction-detail"
          >
            {t("common.close", "Close")}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
