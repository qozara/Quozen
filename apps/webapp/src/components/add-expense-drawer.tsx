import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/context/app-context";
import { useToast } from "@/hooks/use-toast";
import { quozen } from "@/lib/storage";
import ExpenseForm from "@/components/expense-form";
import { useTranslation } from "react-i18next";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { useEffect } from "react";

export default function AddExpenseDrawer() {
    const { activeGroupId, currentUserId, isAddExpenseOpen, setIsAddExpenseOpen } = useAppContext();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { t } = useTranslation();
    const { setPaused } = useAutoSync();

    useEffect(() => {
        if (isAddExpenseOpen) setPaused(true);
        return () => setPaused(false);
    }, [isAddExpenseOpen, setPaused]);

    const { data: ledger } = useQuery({
        queryKey: ["drive", "group", activeGroupId],
        queryFn: () => quozen.ledger(activeGroupId).getLedger(),
        enabled: !!activeGroupId && isAddExpenseOpen,
    });

    const users = ledger?.members || [];

    const expenseMutation = useMutation({
        mutationFn: async (data: any) => {
            if (!activeGroupId) throw new Error("No active group");
            return await quozen.ledger(activeGroupId).addExpense({
                description: data.description,
                amount: data.amount,
                category: data.category,
                date: data.date,
                paidByUserId: data.paidByUserId,
                splits: data.splits
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
            navigator.vibrate?.(50);
            toast({
                title: t("common.success"),
                description: t("expenseForm.save"),
            });
            setIsAddExpenseOpen(false);
        },
        onError: (error) => {
            console.error(error);
            toast({
                title: t("common.error"),
                description: t("expenseForm.addError"),
                variant: "destructive",
            });
        },
    });

    return (
        <Drawer open={isAddExpenseOpen} onOpenChange={setIsAddExpenseOpen}>
            <DrawerContent
                onCloseAutoFocus={(event) => {
                    if (event.defaultPrevented) return;
                }}
            >
                <DrawerHeader>
                    <DrawerTitle data-testid="drawer-title-add-expense">{t("expenseForm.addTitle")}</DrawerTitle>
                    <DrawerDescription>
                        {t("expenseForm.missingInfoDesc")}
                    </DrawerDescription>
                </DrawerHeader>

                <div className="flex-1 overflow-y-auto px-4 pb-0">
                    <ExpenseForm
                        users={users}
                        currentUserId={currentUserId}
                        isPending={expenseMutation.isPending}
                        onSubmit={(data) => expenseMutation.mutate(data)}
                        onCancel={() => setIsAddExpenseOpen(false)}
                        isDrawer // Prop to tell form it's in a drawer (handles footer differently if needed)
                    />
                </div>
            </DrawerContent>
        </Drawer>
    );
}
