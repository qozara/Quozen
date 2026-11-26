import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/context/app-context";
import { quozen } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import ExpenseForm from "@/components/expense-form";
import { CategoryIcon, getCategoryTheme } from "@/components/category-icon";
import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useState, useEffect } from "react";
import { ConflictError, NotFoundError, DEFAULT_CATEGORIES, resolveCategory } from "@quozen/core";
import { useTranslation } from "react-i18next";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";

export default function EditExpense() {
  const { id } = useParams();
  const { activeGroupId, currentUserId } = useAppContext();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [conflictError, setConflictError] = useState<string | null>(null);
  const [notFoundError, setNotFoundError] = useState(false);

  const { data: ledger, isLoading, refetch } = useQuery({
    queryKey: ["drive", "group", activeGroupId],
    queryFn: () => quozen.ledger(activeGroupId!, currentUserId).getLedger(),
    enabled: !!activeGroupId,
  });

  const expense = ledger?.expenses.find((e: any) => e.id === id);
  const availableCategories = ledger?.categories ?? DEFAULT_CATEGORIES;
  const resolvedInitialCategory = expense?.category
    ? resolveCategory(expense.category, availableCategories)?.id || expense.category
    : availableCategories[0]?.id || "";
  const [activeCategoryId, setActiveCategoryId] = useState(resolvedInitialCategory);

  useEffect(() => {
    if (resolvedInitialCategory) {
      setActiveCategoryId(resolvedInitialCategory);
    }
  }, [resolvedInitialCategory]);

  const categoryTheme = getCategoryTheme(activeCategoryId);

  useEffect(() => {
    if (!isLoading && ledger && !expense) {
      setNotFoundError(true);
    }
  }, [isLoading, ledger, expense]);

  const editMutation = useMutation({
    mutationFn: (updatedData: any) => {
      if (!activeGroupId || !expense) throw new Error("Missing required data");

      return quozen.ledger(activeGroupId, currentUserId).updateExpense(
        expense.id,
        {
          description: updatedData.description,
          amount: updatedData.amount,
          category: updatedData.category,
          date: updatedData.date,
          paidByUserId: updatedData.paidByUserId,
          splits: updatedData.splits
        },
        expense.updatedAt ? new Date(expense.updatedAt) : undefined
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
      navigator.vibrate?.(50);
      navigate("/expenses");
    },
    onError: (error) => {
      console.error(error);
      if (error instanceof ConflictError) {
        setConflictError(error.message);
      } else if (error instanceof NotFoundError) {
        setNotFoundError(true);
      } else {
        toast({
          title: t("common.error"),
          description: t("expenseForm.updateError"),
          variant: "destructive"
        });
      }
    }
  });

  const handleRefresh = async () => {
    setConflictError(null);
    setNotFoundError(false);
    await refetch();
  };

  const handleBack = () => {
    navigate("/expenses");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p className="ml-3 text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  if (notFoundError) {
    return (
      <AlertDialog open={true}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("expenseForm.notFoundTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("expenseForm.notFoundDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleBack}>{t("expenseForm.goBack")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (!ledger || !expense) return null;

  return (
    <>
      <Drawer open={true} onOpenChange={(open) => !open && handleBack()}>
        <DrawerContent
          className={cn(
            "max-h-[85vh] overflow-hidden transition-colors duration-300 motion-reduce:transition-none",
            categoryTheme.topBorder
          )}
        >
          <div
            aria-hidden="true"
            data-testid="drawer-category-aura"
            data-category-id={activeCategoryId}
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b blur-2xl opacity-90 transition-all duration-300 motion-reduce:transition-none",
              categoryTheme.ambientGlow
            )}
          />
          <DrawerHeader className="relative z-10 flex items-center gap-3 text-left">
            <div
              data-testid="drawer-category-hero-icon"
              className={cn(
                "w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 transition-colors duration-300 motion-reduce:transition-none",
                categoryTheme.iconContainer
              )}
            >
              <CategoryIcon
                categoryId={activeCategoryId}
                categories={availableCategories}
                aria-hidden="true"
                className="w-5 h-5"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <DrawerTitle data-testid="drawer-title-edit-expense">{t("expenseForm.editTitle")}</DrawerTitle>
              <DrawerDescription className="sr-only">Edit expense form</DrawerDescription>
            </div>
          </DrawerHeader>
          <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-0">
            <ExpenseForm
              initialData={expense}
              users={ledger.members}
              categories={ledger.categories}
              currentUserId={currentUserId}
              isPending={editMutation.isPending}
              onCategoryChange={setActiveCategoryId}
              onSubmit={(data) => editMutation.mutate(data)}
              onCancel={handleBack}
              isDrawer
            />
          </div>
        </DrawerContent>
      </Drawer >

      <AlertDialog open={!!conflictError}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="alert-conflict-title">{t("expenseForm.conflictTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {conflictError}
              <br /><br />
              {t("expenseForm.conflictDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConflictError(null)}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRefresh}>{t("expenseForm.refreshData")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
