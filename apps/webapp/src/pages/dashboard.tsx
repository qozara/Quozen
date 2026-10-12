import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/context/app-context";
import { useOptionalAuth } from "@/context/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SettlementModal from "@/components/settlement-modal";
import { useState, useMemo } from "react";
import {
  Utensils, Car, Bed, ShoppingBag, Gamepad2, MoreHorizontal,
  Wallet, Handshake, ChevronDown, ArrowRight, Banknote, User, Check, Pencil
} from "lucide-react";
import { quozen } from "@/lib/storage";
import { useNavigate } from "react-router-dom";
import {
  Expense,
  Settlement,
  formatCurrency
} from "@quozen/core";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { useSettings } from "@/hooks/use-settings";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { activeGroupId, currentUserId, setActiveAccountId, setIsAddExpenseOpen } = useAppContext();
  const auth = useOptionalAuth();
  const authUser = auth?.user;
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { formatDate } = useDateFormatter();
  const { settings, updateGroupAccount } = useSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const currencyCode = settings?.preferences?.defaultCurrency || "USD";

  const [settlementModal, setSettlementModal] = useState<{
    isOpen: boolean;
    fromUser?: { userId: string; name: string };
    toUser?: { userId: string; name: string };
    suggestedAmount?: number;
    initialData?: Settlement;
  }>({ isOpen: false });

  const [isBalancesOpen, setIsBalancesOpen] = useState(true);
  const [isActivityOpen, setIsActivityOpen] = useState(true);

  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  const [pendingSwitch, setPendingSwitch] = useState<{
    targetUserId: string;
    targetName: string;
    unusedMemberId: string;
    unusedMemberName: string;
  } | null>(null);

  const { data: ledger, isLoading } = useQuery({
    queryKey: ["drive", "group", activeGroupId],
    queryFn: () => quozen.ledger(activeGroupId, currentUserId).getLedger(),
    enabled: !!activeGroupId,
  });

  const expenses = ledger?.expenses || [];
  const settlements = ledger?.settlements || [];
  const users = ledger?.members || [];

  const currentUser = useMemo(() => {
    if (!users.length) return undefined;
    return (
      users.find(u => u.userId === currentUserId) ||
      (authUser?.email ? users.find(u => u.email === authUser.email) : undefined) ||
      users[0]
    );
  }, [users, currentUserId, authUser?.email]);

  const effectiveUserId = currentUser?.userId || currentUserId;

  const isManagingSharedOrOffline = Boolean(
    currentUser &&
      authUser &&
      (currentUser.userId !== authUser.id ||
        (authUser.name && currentUser.name !== authUser.name))
  );

  const applyAccountSwitch = (accountId: string, accountName?: string) => {
    if (setActiveAccountId) {
      setActiveAccountId(accountId);
    } else if (updateGroupAccount && activeGroupId) {
      updateGroupAccount({ groupId: activeGroupId, accountId });
    }
    if (accountName) {
      toast({
        title: t("common.success"),
        description: t("dashboard.accountSwitched", { name: accountName }),
      });
    }
  };

  const handleSelectAccount = (targetUserId: string) => {
    if (targetUserId === effectiveUserId) return;
    const targetMember = users.find(u => u.userId === targetUserId);
    if (!targetMember) return;

    // Check if the user is switching away from their own unused Personal Account
    const personalMember = users.find(
      u =>
        u.userId === effectiveUserId &&
        (!authUser ||
          u.userId === authUser.id ||
          (authUser.email && u.email === authUser.email))
    );

    if (personalMember && personalMember.role !== "owner" && personalMember.userId !== targetUserId) {
      const hasExpenses = expenses.some(
        e =>
          e.paidByUserId === personalMember.userId ||
          e.splits?.some(s => s.userId === personalMember.userId && s.amount > 0)
      );
      const hasSettlements = settlements.some(
        s => s.fromUserId === personalMember.userId || s.toUserId === personalMember.userId
      );

      if (!hasExpenses && !hasSettlements) {
        setPendingSwitch({
          targetUserId: targetMember.userId,
          targetName: targetMember.name,
          unusedMemberId: personalMember.userId,
          unusedMemberName: personalMember.name,
        });
        return;
      }
    }

    applyAccountSwitch(targetUserId, targetMember.name);
  };

  const handleConfirmShareAndRemoveUnused = async () => {
    if (!pendingSwitch || !activeGroupId) return;
    const { targetUserId, targetName, unusedMemberId } = pendingSwitch;
    setPendingSwitch(null);
    try {
      await quozen.ledger(activeGroupId, targetUserId).removeUnusedMember(unusedMemberId);
      applyAccountSwitch(targetUserId, targetName);
      queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
    } catch (err) {
      console.error("Failed to remove unused personal account", err);
      applyAccountSwitch(targetUserId, targetName);
    }
  };

  const handleJustSwitchView = () => {
    if (!pendingSwitch) return;
    const { targetUserId, targetName } = pendingSwitch;
    setPendingSwitch(null);
    applyAccountSwitch(targetUserId, targetName);
  };

  const handleOpenRename = () => {
    if (!currentUser) return;
    setRenameValue(currentUser.name);
    setIsRenameOpen(true);
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroupId || !currentUser || !renameValue.trim()) return;
    setIsRenaming(true);
    try {
      await quozen.ledger(activeGroupId, effectiveUserId).renameMember(effectiveUserId, renameValue.trim());
      queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
      setIsRenameOpen(false);
      toast({
        title: t("common.success"),
        description: t("dashboard.accountRenamed"),
      });
    } catch (err) {
      console.error("Failed to rename account", err);
      toast({
        title: t("common.error"),
        description: t("common.genericError"),
        variant: "destructive",
      });
    } finally {
      setIsRenaming(false);
    }
  };

  const getUserById = (id: string) => {
    const u = users.find(u => u.userId === id);
    return u ? { userId: u.userId, name: u.name, email: u.email } : undefined;
  };

  const getMemberName = (id: string) => {
    const u = users.find(u => u.userId === id);
    return u ? u.name : "Unknown";
  };

  const balances = useMemo(() => ledger?.getBalances() || {}, [ledger]);
  const totalSpent = useMemo(() => ledger?.getTotalSpent(effectiveUserId) || 0, [ledger, effectiveUserId]);
  const userBalance = ledger?.getUserBalance(effectiveUserId) || 0;

  const recentActivity = useMemo(() => {
    const combined = [
      ...expenses.map(e => ({ ...e, type: 'expense' as const })),
      ...settlements.map(s => ({ ...s, type: 'settlement' as const }))
    ];

    return combined
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);
  }, [expenses, settlements]);

  const getExpenseIcon = (category: string) => {
    switch (category?.toLowerCase()) {
      case "food": case "food & dining": return Utensils;
      case "transportation": return Car;
      case "accommodation": return Bed;
      case "shopping": return ShoppingBag;
      case "entertainment": return Gamepad2;
      default: return MoreHorizontal;
    }
  };

  const settlementSuggestion = useMemo(() => ledger?.getSettleUpSuggestion(effectiveUserId), [ledger, effectiveUserId]);


  const handleSettleUp = () => {
    if (!currentUser || !settlementSuggestion) return;

    const fromUser = getUserById(settlementSuggestion.fromUserId);
    const toUser = getUserById(settlementSuggestion.toUserId);

    if (fromUser && toUser) {
      setSettlementModal({
        isOpen: true,
        fromUser,
        toUser,
        suggestedAmount: settlementSuggestion.amount,
        initialData: undefined
      });
    }
  };

  const handleSettleWith = (targetUserId: string) => {
    if (!currentUser || !ledger) return;
    const targetUser = getUserById(targetUserId);
    if (!targetUser) return;

    const settlement = ledger.getSettleUpSuggestion(targetUserId);

    if (settlement) {
      const fromUser = getUserById(settlement.fromUserId);
      const toUser = getUserById(settlement.toUserId);

      if (fromUser && toUser) {
        setSettlementModal({
          isOpen: true,
          fromUser,
          toUser,
          suggestedAmount: settlement.amount,
          initialData: undefined
        });
      }
    }
  };

  if (isLoading) {
    return <div className="p-4 text-center" data-testid="loading-indicator">{t("common.loading")}</div>;
  }

  if (!ledger) {
    return <div className="p-4 text-center">{t("dashboard.groupNotFound")}</div>;
  }

  return (
    <>
      <div className="space-y-4" data-testid="dashboard-view">
        <div className="mx-4 mt-4 bg-card rounded-lg border border-border p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3 gap-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" /> {t("dashboard.balance")}
            </h2>
            {currentUser && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-testid="button-account-switcher"
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                      isManagingSharedOrOffline
                        ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15"
                        : "bg-secondary/60 text-muted-foreground border-border hover:bg-secondary"
                    )}
                  >
                    <User className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate max-w-[130px]" data-testid="text-active-account-name">
                      {currentUser.name}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 opacity-70 shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {t("dashboard.activeAccount")}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {users.map((u) => {
                    const isSelected = u.userId === effectiveUserId;
                    return (
                      <DropdownMenuItem
                        key={u.userId}
                        onClick={() => handleSelectAccount(u.userId)}
                        data-testid={`menu-item-account-${u.userId}`}
                        className="flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Check className={cn("w-4 h-4 text-primary shrink-0", !isSelected && "opacity-0")} />
                          <span className={cn("truncate", isSelected && "font-semibold")}>{u.name}</span>
                        </div>
                        {u.role === "owner" && (
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded ml-2 shrink-0">
                            {t("roles.owner")}
                          </span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleOpenRename}
                    data-testid="menu-item-rename-account"
                    className="cursor-pointer"
                  >
                    <Pencil className="w-4 h-4 mr-2 text-muted-foreground" />
                    <span>{t("dashboard.renameAccount")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className="text-center py-2">
            <div
              className={`text-4xl font-bold ${userBalance >= 0 ? 'expense-positive' : 'expense-negative'}`}
              data-testid="text-user-balance"
            >
              {userBalance > 0 ? '+' : userBalance < 0 ? '-' : ''}{formatCurrency(Math.abs(userBalance), currencyCode, i18n.language)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {userBalance >= 0 ? t("dashboard.owed") : t("dashboard.owe")}
            </p>

            <div className="mt-4 pt-4 border-t border-dashed border-border flex justify-between items-center px-8">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{t("dashboard.totalSpent")}</span>
              <span className="font-medium text-foreground">{formatCurrency(totalSpent, currencyCode, i18n.language)}</span>
            </div>

            <div className="mt-6">
              <Button
                variant={userBalance < 0 ? "default" : "outline"}
                size="lg"
                className={cn(
                  "w-full font-semibold",
                  userBalance < 0 ? "bg-primary text-primary-foreground shadow-md hover:bg-primary/90" : "text-primary border-primary/20 hover:bg-primary/10"
                )}
                onClick={handleSettleUp}
                disabled={!settlementSuggestion}
                data-testid="button-settle-up"
              >
                {userBalance < 0 ? t("dashboard.payDebt") : t("dashboard.requestSettlement")}
              </Button>
            </div>
          </div>
        </div>

        <div className="mx-4 bg-card rounded-lg border border-border overflow-hidden">
          <Collapsible open={isBalancesOpen} onOpenChange={setIsBalancesOpen}>
            <CollapsibleTrigger className="w-full flex items-center justify-between p-4 border-b border-border bg-muted/30 hover:bg-muted/50 transition-colors" data-testid="collapsible-group-balances">
              <h3 className="font-semibold text-foreground text-sm uppercase tracking-wide">{t("dashboard.groupBalances")}</h3>
              <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-200", !isBalancesOpen && "-rotate-90")} />
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="divide-y divide-border">
                {users
                  .filter(u => u.userId !== effectiveUserId)
                  .map((u) => {
                    const balance = balances[u.userId] || 0;

                    return (
                      <div key={u.userId} className="p-4 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center border border-border">
                            <span className="text-foreground font-medium text-sm">
                              {u.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{u.name}</p>
                            {u.role === 'owner' && (
                              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                {t("roles.owner")}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div
                              className={`font-semibold ${balance >= 0 ? 'expense-positive' : 'expense-negative'}`}
                              data-testid={`text-balance-${u.userId}`}
                            >
                              {balance > 0 ? '+' : balance < 0 ? '-' : ''}{formatCurrency(Math.abs(balance), currencyCode, i18n.language)}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-11 w-11 rounded-full text-primary border-primary/20 hover:bg-primary/10 transition-colors"
                            onClick={() => handleSettleWith(u.userId)}
                            data-testid={`button-settle-with-${u.userId}`}
                            title={t("dashboard.settle")}
                          >
                            <Banknote className="w-5 h-5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <div className="mx-4 bg-card rounded-lg border border-border overflow-hidden">
          <Collapsible open={isActivityOpen} onOpenChange={setIsActivityOpen}>
            <CollapsibleTrigger className="w-full flex items-center justify-between p-4 border-b border-border bg-muted/30 hover:bg-muted/50 transition-colors">
              <h3 className="font-semibold text-foreground text-sm uppercase tracking-wide">{t("dashboard.recentActivity")}</h3>
              <div className="flex items-center gap-2">
                <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform duration-200", !isActivityOpen && "-rotate-90")} />
              </div>
            </CollapsibleTrigger>

            <CollapsibleContent>
              {isActivityOpen && (
                <div className="divide-y divide-border">
                  {recentActivity.length === 0 ? (
                    <div className="p-8 text-center">
                      <p className="text-muted-foreground text-sm">{t("dashboard.noActivity")}</p>
                      <Button variant="link" onClick={() => setIsAddExpenseOpen(true)} className="mt-2">{t("dashboard.addFirst")}</Button>
                    </div>
                  ) : (
                    recentActivity.map((item) => {
                      if (item.type === 'settlement') {
                        const s = item as Settlement;
                        const fromName = s.fromUserId === effectiveUserId ? t("dashboard.you") : getMemberName(s.fromUserId).split(' ')[0];
                        const toName = s.toUserId === effectiveUserId ? t("dashboard.you") : getMemberName(s.toUserId).split(' ')[0];
                        const isMeSender = s.fromUserId === effectiveUserId;
                        const isMeReceiver = s.toUserId === effectiveUserId;

                        let colorClass = "text-muted-foreground";
                        if (isMeSender) colorClass = "text-orange-600 dark:text-orange-400";
                        if (isMeReceiver) colorClass = "text-green-600 dark:text-green-400";

                        return (
                          <div
                            key={s.id}
                            className="p-4 hover:bg-muted/50 transition-colors cursor-pointer"
                            onClick={() => setSettlementModal({ isOpen: true, initialData: s })}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center space-x-3">
                                <div className="w-10 h-10 bg-secondary/50 rounded-full flex items-center justify-center border border-border">
                                  <Handshake className="w-5 h-5 text-muted-foreground" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-1 font-medium text-foreground text-sm">
                                    <span>{fromName}</span>
                                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                                    <span>{toName}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {t("dashboard.transfer")} • {formatDate(s.date, "MMM d")}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={cn("font-bold text-sm", colorClass)}>
                                  {formatCurrency(Number(s.amount), currencyCode, i18n.language)}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      const e = item as Expense;
                      const paidByUser = getUserById(e.paidByUserId);
                      const Icon = getExpenseIcon(e.category);
                      const status = ledger?.getExpenseStatus(e.id, effectiveUserId) || { status: 'none' };

                      return (
                        <div key={e.id} className="p-4 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => navigate(`/edit-expense/${e.id}`)} data-testid={`expense-item-${e.id}`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center border border-border">
                                <Icon className="w-5 h-5 text-muted-foreground" />
                              </div>
                              <div>
                                <p className="font-medium text-foreground text-sm">{e.description}</p>
                                <p className="text-xs text-muted-foreground">
                                  {paidByUser?.name || 'Unknown'} • {formatDate(e.date, "MMM d")}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-semibold text-foreground text-sm">{formatCurrency(Number(e.amount), currencyCode, i18n.language)}</div>

                              {status.status === 'payer' && (
                                <div className="text-xs expense-positive">{t("dashboard.paid")}</div>
                              )}
                              {status.status === 'debtor' && (
                                <div className="text-xs expense-negative">{t("dashboard.owe").split(' ')[0]} {formatCurrency(status.amountOwed, currencyCode, i18n.language)}</div>
                              )}
                              {status.status === 'none' && (
                                <div className="text-xs text-muted-foreground">{t("dashboard.notInvolved")}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div className="p-2 text-center bg-muted/10">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-primary h-8 w-full"
                      data-testid="button-view-all-expenses"
                      onClick={() => navigate('/expenses')}
                    >
                      {t("dashboard.viewHistory")}
                    </Button>
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>

      <SettlementModal
        isOpen={settlementModal.isOpen}
        onClose={() => setSettlementModal({ isOpen: false })}
        fromUser={settlementModal.fromUser as any}
        toUser={settlementModal.toUser as any}
        suggestedAmount={settlementModal.suggestedAmount}
        initialData={settlementModal.initialData}
        users={users}
      />

      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent data-testid="dialog-rename-account">
          <DialogHeader>
            <DialogTitle>{t("dashboard.renameAccountTitle")}</DialogTitle>
            <DialogDescription>
              {t("dashboard.renameAccountDesc")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className="space-y-4">
            <div>
              <Label htmlFor="rename-account-input">{t("dashboard.accountNameLabel")}</Label>
              <Input
                id="rename-account-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                required
                data-testid="input-rename-account"
                className="mt-1"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsRenameOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isRenaming || !renameValue.trim()}
                data-testid="button-save-rename-account"
              >
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingSwitch} onOpenChange={(open) => !open && setPendingSwitch(null)}>
        <AlertDialogContent data-testid="alert-share-account-cleanup">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dashboard.shareAccountConfirmTitle", { targetName: pendingSwitch?.targetName || "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dashboard.shareAccountConfirmDesc", {
                unusedName: pendingSwitch?.unusedMemberName || "",
                targetName: pendingSwitch?.targetName || ""
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleJustSwitchView}
              data-testid="button-switch-view-only"
            >
              {t("dashboard.justSwitchView")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmShareAndRemoveUnused}
              data-testid="button-confirm-share-account"
            >
              {t("dashboard.shareAndRemoveUnused", {
                targetName: pendingSwitch?.targetName || "",
                unusedName: pendingSwitch?.unusedMemberName || ""
              })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
