import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/context/app-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Trash2, Receipt, Plus, MoreVertical, Edit
} from "lucide-react";
import { CategoryIcon, getCategoryBadgeColor, getCategoryDisplayName } from "@/components/category-icon";
import { quozen } from "@/lib/storage";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ConflictError,
  NotFoundError,
  Ledger,
  Expense,
  Member,
  ExpenseCategory,
  formatCurrency
} from "@quozen/core";

import { useTranslation } from "react-i18next";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { useSettings } from "@/hooks/use-settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Interface for props passed from ActivityHub
interface ExpensesListProps {
  expenses: Expense[];
  members: Member[];
  categories?: ExpenseCategory[];
  isLoading?: boolean;
}

export default function ExpensesList({ expenses = [], members = [], categories = [], isLoading = false }: ExpensesListProps) {
  const { activeGroupId, currentUserId, setIsAddExpenseOpen } = useAppContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { formatDate } = useDateFormatter();
  const { settings } = useSettings();

  const currencyCode = settings?.preferences?.defaultCurrency || "USD";

  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (expense: Expense) => {
      return quozen.ledger(activeGroupId, currentUserId).deleteExpense(expense.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
      setExpenseToDelete(null);
    },
    onError: (error) => {
      setExpenseToDelete(null);
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        toast({
          title: t("expenseItem.syncError"),
          description: t("expenseItem.syncErrorDesc"),
          variant: "destructive"
        });
        queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
      } else {
        toast({
          title: t("expenseItem.deleteError"),
          description: t("expenseItem.deleteErrorDesc"),
          variant: "destructive"
        });
      }
    }
  });

  const getUserById = (id: string) => members.find(u => u.userId === id);

  const ledgerObj = useMemo(() => new Ledger({ expenses, members, settlements: [], categories }), [expenses, members, categories]);

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-6">
          <Receipt className="w-10 h-10 text-muted-foreground/20" />
        </div>
        <h3 className="text-xl font-bold mb-2">{t("activity.noExpenses")}</h3>
        <p className="text-muted-foreground mb-8 max-w-[280px]">
          {t("activity.startAdding")}
        </p>
        <Button onClick={() => setIsAddExpenseOpen(true)} className="h-12 px-8">
          <Plus className="w-4 h-4 mr-2" />
          {t("expenseForm.addTitle")}
        </Button>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 space-y-3">
      {expenses.map((expense) => {
        const paidByUser = getUserById(expense.paidByUserId);
        const status = ledgerObj.getExpenseStatus(expense.id, currentUserId);

        return (
          <Card key={expense.id} data-testid={`card-expense-${expense.id}`} className="hover:shadow-md transition-all">
            <CardContent className="p-4 cursor-pointer" onClick={() => navigate(`/edit-expense/${expense.id}`)}>
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3">
                  <div className="w-12 h-12 bg-secondary/50 rounded-xl flex items-center justify-center border border-border shrink-0">
                    <CategoryIcon categoryId={expense.category} categories={categories} className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground line-clamp-1 text-sm">{expense.description}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {paidByUser?.name || 'Unknown'} • {formatDate(expense.date)}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      <Badge variant="secondary" className={`font-normal text-[10px] px-1.5 py-0 border-0 ${getCategoryBadgeColor(expense.category)}`}>
                        {getCategoryDisplayName(expense.category, categories)}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-bold text-base text-foreground">
                        {formatCurrency(Number(expense.amount), currencyCode, i18n.language)}
                      </div>
                      {status.status === 'payer' && (
                        <div className="text-[10px] expense-positive font-medium">{t("expenseItem.paid")}</div>
                      )}
                      {status.status === 'debtor' && (
                        <div className="text-[10px] expense-negative font-medium">{t("expenseItem.owe", { amount: formatCurrency(status.amountOwed, currencyCode, i18n.language) })}</div>
                      )}
                      {status.status === 'none' && (
                        <div className="text-[10px] text-muted-foreground">{t("expenseItem.notInvolved")}</div>
                      )}
                    </div>

                    <div onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 -mr-2 text-muted-foreground hover:text-foreground"
                            aria-label={`Options for ${expense.description}`}
                            data-testid={`button-options-expense-${expense.id}`}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/edit-expense/${expense.id}`); }}>
                            <Edit className="w-4 h-4 mr-2" />
                            {t("common.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setExpenseToDelete(expense); }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <AlertDialog open={!!expenseToDelete} onOpenChange={(open) => !open && setExpenseToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("expenseItem.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("expenseItem.deleteDesc", { description: expenseToDelete?.description })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => expenseToDelete && deleteMutation.mutate(expenseToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? t("common.loading") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
