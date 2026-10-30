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
import { useEffect, useState } from "react";
import { useAiFeature } from "@/features/agent/AiFeatureContext";
import { CommandDraftService } from "@quozen/core";
import { LlmIntentEscalator } from "@quozen/ai-services";
import { useSettings } from "@/hooks/use-settings";

export default function AddExpenseDrawer() {
    const {
        activeGroupId,
        currentUserId,
        isAddExpenseOpen,
        setIsAddExpenseOpen,
        expenseDraft,
        setExpenseDraft,
        expenseDraftMeta
    } = useAppContext();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { t, i18n } = useTranslation();
    const { groups } = useGroups();
    const { settings } = useSettings();
    const { status: aiStatus } = useAiFeature();
    const [isRefining, setIsRefining] = useState(false);

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

    const handleClose = () => {
        setIsAddExpenseOpen(false);
        setExpenseDraft(null);
    };

    const handleRefineWithAi = async () => {
        if (!expenseDraftMeta?.rawInput || !ledger || isRefining) return;
        setIsRefining(true);
        try {
            const escalator = new LlmIntentEscalator({
                proxyUrl: (import.meta as any).env.VITE_AI_PROXY_URL || 'http://localhost:8788',
                provider: settings?.preferences?.aiProvider as any,
                ciphertext: settings?.encryptedApiKey,
                enableLocalAi: settings?.preferences?.enableLocalAi ?? false,
                ollamaBaseUrl: settings?.preferences?.ollamaBaseUrl,
                ollamaModel: settings?.preferences?.ollamaModel
            });
            const draftService = new CommandDraftService({ escalator });
            const locale = settings?.preferences?.locale === 'system' ? i18n.language : (settings?.preferences?.locale || 'en');
            const result = await draftService.createDraft({
                input: expenseDraftMeta.rawInput,
                ledger,
                activeAccountId: currentUserId,
                locale,
                forceAi: true
            });

            if (result.expenseDraft) {
                setExpenseDraft(result.expenseDraft);
                toast({
                    title: t("common.success"),
                    description: t("agent.refinedSuccess", "Draft updated with AI")
                });
            }
        } catch (err: any) {
            console.error("AI refinement error:", err);
            toast({
                title: t("common.error"),
                description: err.message || t("agent.errorGeneric"),
                variant: "destructive"
            });
        } finally {
            setIsRefining(false);
        }
    };

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
            handleClose();
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
        <Drawer open={isAddExpenseOpen} onOpenChange={(open) => {
            if (!open) handleClose();
            else setIsAddExpenseOpen(true);
        }}>
            <DrawerContent
                onCloseAutoFocus={(event) => {
                    if (event.defaultPrevented) return;
                }}
            >
                <DrawerHeader>
                    <DrawerTitle data-testid="drawer-title-add-expense">
                        {expenseDraft ? t("expenseForm.reviewDraftTitle", "Review Expense") : t("expenseForm.addTitle")}
                    </DrawerTitle>
                    <DrawerDescription>
                        {expenseDraft
                            ? t("expenseForm.reviewDraftDesc", "Confirm or adjust details before saving.")
                            : t("expenseForm.missingInfoDesc")}
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
                            draft={expenseDraft || undefined}
                            draftMeta={expenseDraftMeta}
                            onRefineWithAi={aiStatus === 'available' && isOnline ? handleRefineWithAi : undefined}
                            isRefiningWithAi={isRefining}
                            categories={ledger?.categories}
                            currentUserId={currentUserId}
                            isPending={expenseMutation.isPending}
                            onSubmit={(data) => expenseMutation.mutate(data)}
                            onCancel={handleClose}
                            isDrawer
                        />
                    )}
                </div>
            </DrawerContent>
        </Drawer>
    );
}
