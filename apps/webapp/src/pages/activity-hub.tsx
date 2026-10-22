import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/context/app-context";
import { quozen } from "@/lib/storage";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Handshake, ArrowUpDown, MoreVertical, Edit, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
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
import SettlementModal from "@/components/settlement-modal";
import ExpensesList from "./expenses";
import { Member, Settlement, formatCurrency } from "@quozen/core";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { useSettings } from "@/hooks/use-settings";

type SortOption = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

export default function ActivityHub() {
    const { activeGroupId, currentUserId } = useAppContext();
    const [activeTab, setActiveTab] = useState("expenses");
    const { t, i18n } = useTranslation();
    const { formatDate } = useDateFormatter();
    const { settings } = useSettings();
    const currencyCode = settings?.preferences?.defaultCurrency || "USD";

    // Expenses State
    const [sortOption, setSortOption] = useState<SortOption>("date_desc");
    const [filterMyExpenses, setFilterMyExpenses] = useState(false); // true = Show Me Only, false = Show All

    // Settlements Tab State
    const [sortTransfersOption, setSortTransfersOption] = useState<SortOption>("date_desc");
    const [showAllSettlements, setShowAllSettlements] = useState(false); // false = Show Me Only
    const [editingSettlement, setEditingSettlement] = useState<Settlement | null>(null);
    const [deletingSettlement, setDeletingSettlement] = useState<Settlement | null>(null);
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Fetch Data
    const { data: ledger, isLoading } = useQuery({
        queryKey: ["drive", "group", activeGroupId],
        queryFn: () => quozen.ledger(activeGroupId).getLedger(),
        enabled: !!activeGroupId,
    });

    const settlements = ledger?.settlements || [];
    const expenses = ledger?.expenses || [];
    const members = ledger?.members || [];

    // -------------------------
    // Process Expenses
    // -------------------------
    const filteredExpenses = useMemo(() => {
        let result = [...expenses];

        // Filter
        if (filterMyExpenses) {
            result = result.filter(e =>
                e.paidByUserId === currentUserId ||
                e.splits?.some((s: any) => s.userId === currentUserId && s.amount > 0)
            );
        }

        // Sort
        result.sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            const amountA = Number(a.amount);
            const amountB = Number(b.amount);

            switch (sortOption) {
                case "date_asc": return dateA - dateB;
                case "date_desc": return dateB - dateA;
                case "amount_asc": return amountA - amountB;
                case "amount_desc": return amountB - amountA;
                default: return 0;
            }
        });

        return result;
    }, [expenses, sortOption, filterMyExpenses, currentUserId]);

    // -------------------------
    // Process Settlements
    // -------------------------
    const filteredSettlements = useMemo(() => {
        let result = [...settlements];

        // Filter
        if (!showAllSettlements) {
            result = result.filter(s => s.fromUserId === currentUserId || s.toUserId === currentUserId);
        }

        // Sort
        result.sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            const amountA = Number(a.amount);
            const amountB = Number(b.amount);

            switch (sortTransfersOption) {
                case "date_asc": return dateA - dateB;
                case "date_desc": return dateB - dateA;
                case "amount_asc": return amountA - amountB;
                case "amount_desc": return amountB - amountA;
                default: return 0;
            }
        });

        return result;
    }, [settlements, showAllSettlements, sortTransfersOption, currentUserId]);

    const deleteMutation = useMutation({
        mutationFn: async (s: Settlement) => {
            return await quozen.ledger(activeGroupId).deleteSettlement(s.id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
            setDeletingSettlement(null);
        },
        onError: (error) => {
            console.error(error);
            toast({ title: t("common.error"), variant: "destructive" });
        }
    });

    const getMember = (id: string) => members.find(m => m.userId === id) || { name: "Unknown", userId: id } as Member;

    return (
        <div className="min-h-screen bg-background pb-20">
            {/* Sticky Tabs Header */}
            <div className="sticky top-[57px] z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border shadow-sm pt-2 pb-2 px-4">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="expenses">{t("activity.expensesTab")}</TabsTrigger>
                        <TabsTrigger value="transfers">{t("activity.transfersTab")}</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            <div className="mt-2">
                {activeTab === 'expenses' ? (
                    <div className="flex flex-col">
                        {/* Sub-header for Expenses */}
                        <div className="px-4 py-4 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                                {filterMyExpenses ? t("activity.myExpenses") : t("activity.allExpenses")}
                            </h3>
                            <div className="flex items-center gap-2">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted text-muted-foreground">
                                            <ArrowUpDown className={cn("w-4 h-4 transition-colors", sortOption !== 'date_desc' && "text-primary")} />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuLabel>{t("activity.sortBy")}</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => setSortOption("date_desc")}>
                                            {t("activity.dateNewest")}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setSortOption("date_asc")}>
                                            {t("activity.dateOldest")}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setSortOption("amount_desc")}>
                                            {t("activity.amountHigh")}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setSortOption("amount_asc")}>
                                            {t("activity.amountLow")}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>

                                {/* Me/All Toggle - Segmented Control */}
                                <Tabs
                                    value={filterMyExpenses ? "me" : "all"}
                                    onValueChange={(v) => setFilterMyExpenses(v === "me")}
                                    className="w-[220px]"
                                >
                                    <TabsList className="grid w-full grid-cols-2 h-8">
                                        <TabsTrigger value="me" className="text-[10px] flex-1">
                                            {t("activity.myActivity")}
                                        </TabsTrigger>
                                        <TabsTrigger value="all" className="text-[10px] flex-1">
                                            {t("activity.allActivity")}
                                        </TabsTrigger>
                                    </TabsList>
                                </Tabs>
                            </div>
                        </div>

                        <ExpensesList
                            expenses={filteredExpenses}
                            members={members}
                            categories={ledger?.categories}
                            isLoading={isLoading}
                        />
                    </div>
                ) : (
                    <div className="px-4">
                        <div className="flex items-center justify-between py-4">
                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                                {showAllSettlements ? t("activity.allTransfers") : t("activity.myTransfers")}
                            </h3>

                            <div className="flex items-center gap-2">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted text-muted-foreground">
                                            <ArrowUpDown className={cn("w-4 h-4 transition-colors", sortTransfersOption !== 'date_desc' && "text-primary")} />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuLabel>{t("activity.sortBy")}</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => setSortTransfersOption("date_desc")}>
                                            {t("activity.dateNewest")}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setSortTransfersOption("date_asc")}>
                                            {t("activity.dateOldest")}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setSortTransfersOption("amount_desc")}>
                                            {t("activity.amountHigh")}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => setSortTransfersOption("amount_asc")}>
                                            {t("activity.amountLow")}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>

                                <Tabs
                                    value={showAllSettlements ? "all" : "me"}
                                    onValueChange={(v) => setShowAllSettlements(v === "all")}
                                    className="w-[220px]"
                                >
                                    <TabsList className="grid w-full grid-cols-2 h-8">
                                        <TabsTrigger value="me" className="text-[10px] flex-1">
                                            {t("activity.myActivity")}
                                        </TabsTrigger>
                                        <TabsTrigger value="all" className="text-[10px] flex-1">
                                            {t("activity.allActivity")}
                                        </TabsTrigger>
                                    </TabsList>
                                </Tabs>
                            </div>
                        </div>

                        <div className="space-y-3 pb-4">
                            {filteredSettlements.length === 0 ? (
                                <div className="text-center py-12 opacity-50">
                                    <div className="bg-muted w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <Handshake className="w-8 h-8 text-muted-foreground" />
                                    </div>
                                    <p className="text-sm font-medium">{t("activity.noTransfers")}</p>
                                </div>
                            ) : (
                                filteredSettlements.map((settlement) => {
                                    const from = getMember(settlement.fromUserId);
                                    const to = getMember(settlement.toUserId);
                                    const isMeSender = settlement.fromUserId === currentUserId;
                                    const isMeReceiver = settlement.toUserId === currentUserId;
                                    const isNeutral = !isMeSender && !isMeReceiver;

                                    let statusColor = "text-muted-foreground";
                                    if (isMeSender) statusColor = "text-orange-600 dark:text-orange-400";
                                    if (isMeReceiver) statusColor = "text-green-600 dark:text-green-400";

                                    return (
                                        <Card
                                            key={settlement.id}
                                            className={cn("cursor-pointer transition-all hover:shadow-md border-l-4 border-y-0 border-r-0",
                                                isNeutral ? "opacity-80 bg-muted/10 border-l-muted" :
                                                    isMeSender ? "border-l-orange-500" : "border-l-green-500"
                                            )}
                                            onClick={() => setEditingSettlement(settlement)}
                                        >
                                            <CardContent className="flex items-center justify-between p-4 py-3">
                                                {/* Sender */}
                                                <div className="flex flex-col items-center gap-1 w-14 shrink-0">
                                                    <Avatar className="w-8 h-8 border-2 border-background shadow-sm">
                                                        <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">{from.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                                                    </Avatar>
                                                    <span className="text-[10px] truncate max-w-full font-medium text-muted-foreground">
                                                        {isMeSender ? t("dashboard.you") : from.name.split(' ')[0]}
                                                    </span>
                                                </div>

                                                {/* Flow */}
                                                <div className="flex flex-col items-center justify-center flex-1 px-2 relative">
                                                    {/* Connecting Line with Arrow */}
                                                    <div className="absolute top-1/2 left-0 w-full transform -translate-y-1/2 px-1">
                                                        <div className="w-full h-[1px] bg-border relative">
                                                            <div className="absolute -right-[1px] top-1/2 -translate-y-1/2 w-2 h-2 border-t-2 border-r-2 border-border rotate-45 bg-background" />
                                                        </div>
                                                    </div>

                                                    <div className={cn("relative z-10 text-base font-bold bg-card px-3 rounded-full", statusColor)}>
                                                        {formatCurrency(settlement.amount, currencyCode, i18n.language)}
                                                    </div>
                                                    <span className="text-[9px] text-muted-foreground mt-1 relative z-10 bg-card px-1">
                                                        {formatDate(settlement.date, "MMM d")}
                                                    </span>
                                                </div>

                                                {/* Receiver */}
                                                <div className="flex flex-col items-center gap-1 w-14 shrink-0">
                                                    <Avatar className="w-8 h-8 border-2 border-background shadow-sm">
                                                        <AvatarFallback className="text-[10px] bg-primary/10 text-primary">{to.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                                                    </Avatar>
                                                    <span className="text-[10px] truncate max-w-full font-medium text-muted-foreground">
                                                        {isMeReceiver ? t("dashboard.you") : to.name.split(' ')[0]}
                                                    </span>
                                                </div>

                                                {/* Meatball Menu */}
                                                <div className="ml-2 shrink-0">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                                                <MoreVertical className="w-4 h-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditingSettlement(settlement); }}>
                                                                <Edit className="w-4 h-4 mr-2" />
                                                                {t("common.edit")}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem
                                                                className="text-destructive focus:text-destructive"
                                                                onClick={(e) => { e.stopPropagation(); setDeletingSettlement(settlement); }}
                                                            >
                                                                <Trash2 className="w-4 h-4 mr-2" />
                                                                {t("common.delete")}
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}
            </div>

            {editingSettlement && (
                <SettlementModal
                    isOpen={!!editingSettlement}
                    onClose={() => setEditingSettlement(null)}
                    initialData={editingSettlement}
                    users={members}
                />
            )}

            <AlertDialog open={!!deletingSettlement} onOpenChange={(open) => !open && setDeletingSettlement(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("settlement.deleteTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("settlement.deleteDesc")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deletingSettlement && deleteMutation.mutate(deletingSettlement)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={deleteMutation.isPending}
                        >
                            {deleteMutation.isPending ? t("common.loading") : t("common.delete")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
