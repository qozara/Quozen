import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/context/app-context";
import { useToast } from "@/hooks/use-toast";
import { quozen } from "@/lib/storage";
import ExpenseForm from "@/components/expense-form";
import { useTranslation } from "react-i18next";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { useGroups } from "@/hooks/use-groups";
import { WifiOff } from "lucide-react";
import { useEffect } from "react";

export default function AddExpenseDrawer() {
    const { activeGroupId, currentUserId, isAddExpenseOpen, setIsAddExpenseOpen } = useAppContext();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { t } = useTranslation();
    const { groups } = useGroups();

    let autoSync: any;
    try {
        autoSync = useAutoSync();
    } catch {
        // Fallback for tests without AutoSyncProvider
    }
    const setPaused = autoSync?.setPaused || (() => {});
    const isOnline = autoSync?.isOnline ?? (typeof navigator !== "undefined" ? navigator.onLine !== false : true);

    const activeGroup = groups.find(g => g.id === activeGroupId);
    const activeGroupName = activeGroup?.name || "";

    useEffect(() => {
        if (isAddExpenseOpen) setPaused(true);
        return () => setPaused(false);
    }, [isAddExpenseOpen, setPaused]);

    const { data: ledger, isLoading } = useQuery({
        queryKey: ["drive", "group", activeGroupId],
        queryFn: () => quozen.ledger(activeGroupId, currentUserId).getLedger(),
        enabled: !!activeGroupId && isAddExpenseOpen,
    });

    const users = ledger?.members || [];

    const isUnhydratedOffline = !isLoading && !!ledger && !isOnline && (
        (ledger as any).isHydrated === false ||
        (ledger.members.length === 0 && ledger.expenses.length === 0 && ledger.settlements.length === 0)
    );

    const expenseMutation = useMutation({
        mutationFn: async (data: any) => {
            if (!activeGroupId) throw new Error("No active group");
            return await quozen.ledger(activeGroupId, currentUserId).addExpense({
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
                    {isUnhydratedOffline ? (
                        <div className="py-8 px-4 my-4 rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 flex flex-col items-center text-center space-y-4" data-testid="unhydrated-group-offline">
                            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400 flex items-center justify-center">
                                <WifiOff className="w-6 h-6" />
                            </div>
                            <div className="space-y-1">
                                <h3 className="font-semibold text-lg text-foreground">
                                    {t("offline.unhydratedTitle", { name: activeGroupName })}
                                </h3>
                                <p className="text-sm text-muted-foreground max-w-sm">
                                    {t("offline.unhydratedDesc")}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <ExpenseForm
                            users={users}
                            categories={ledger?.categories}
                            currentUserId={currentUserId}
                            isPending={expenseMutation.isPending}
                            onSubmit={(data) => expenseMutation.mutate(data)}
                            onCancel={() => setIsAddExpenseOpen(false)}
                            isDrawer
                        />
                    )}
                </div>
            </DrawerContent>
        </Drawer>
    );
}
