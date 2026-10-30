import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/context/app-context";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerFooter } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { quozen } from "@/lib/storage";
import { Member, Settlement, SettlementDraft } from "@quozen/core";
import { ArrowRightLeft, Trash2, Zap, AlertTriangle, RefreshCw } from "lucide-react";
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
import { useTranslation } from "react-i18next";
import { useAutoSync } from "@/hooks/use-auto-sync";

interface UserInfo {
  userId: string;
  name: string;
}

interface SettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  fromUser?: UserInfo;
  toUser?: UserInfo;
  suggestedAmount?: number;
  users?: Member[];
  initialData?: Settlement;
  draft?: SettlementDraft;
  draftMeta?: {
    rawInput?: string;
    isAiEscalated?: boolean;
    ambiguities?: string[];
  } | null;
  onRefineWithAi?: () => Promise<void>;
  isRefiningWithAi?: boolean;
}

export default function SettlementModal({
  isOpen,
  onClose,
  fromUser,
  toUser,
  suggestedAmount = 0,
  users = [],
  initialData,
  draft,
  draftMeta,
  onRefineWithAi,
  isRefiningWithAi = false
}: SettlementModalProps) {
  const { activeGroupId, currentUserId } = useAppContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  let autoSync: any;
  try {
    autoSync = useAutoSync();
  } catch {
    // Fallback for tests without AutoSyncProvider
  }
  const setPaused = autoSync?.setPaused || (() => {});

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");

  const [selectedFromId, setSelectedFromId] = useState("");
  const [selectedToId, setSelectedToId] = useState("");

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (isOpen) setPaused(true);
    return () => setPaused(false);
  }, [isOpen, setPaused]);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setAmount(initialData.amount.toString());
        setMethod(initialData.method || "cash");
        setNotes(initialData.notes || "");
        setSelectedFromId(initialData.fromUserId);
        setSelectedToId(initialData.toUserId);
      } else if (draft) {
        setAmount(draft.amount > 0 ? draft.amount.toFixed(2) : "");
        setMethod(draft.method || "cash");
        setNotes(draft.notes || "");
        setSelectedFromId(draft.fromUserId || fromUser?.userId || currentUserId || "");
        setSelectedToId(draft.toUserId || toUser?.userId || "");
      } else {
        setAmount(suggestedAmount > 0 ? suggestedAmount.toFixed(2) : "");
        setMethod("cash");
        setNotes("");
        setSelectedFromId(fromUser?.userId || currentUserId || "");
        setSelectedToId(toUser?.userId || "");
      }
    }
  }, [isOpen, initialData, draft, suggestedAmount, fromUser, toUser, currentUserId]);

  const handleSwap = () => {
    setSelectedFromId(selectedToId);
    setSelectedToId(selectedFromId);
  };

  const getMember = (userId: string) => users.find(u => u.userId === userId);
  const fromMember = getMember(selectedFromId);
  const toMember = getMember(selectedToId);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (initialData) {
        return await quozen.ledger(activeGroupId, currentUserId).updateSettlement(initialData.id, {
          ...data,
          date: data.date ? new Date(data.date) : new Date()
        });
      } else {
        return await quozen.ledger(activeGroupId, currentUserId).addSettlement({
          ...data,
          date: data.date ? new Date(data.date) : new Date()
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
      navigator.vibrate?.(50);
      onClose();
    },
    onError: (error) => {
      console.error(error);
      toast({
        title: t("common.error"),
        description: t("settlement.saveError"),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!initialData) throw new Error("Missing initialData");
      return await quozen.ledger(activeGroupId, currentUserId).deleteSettlement(initialData.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
      setShowDeleteConfirm(false);
      onClose();
    },
    onError: () => {
      toast({ title: t("common.error"), description: t("settlement.deleteError"), variant: "destructive" });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFromId || !selectedToId || !amount || parseFloat(amount) <= 0) return;
    if (selectedFromId === selectedToId) {
      toast({ title: "Invalid selection", description: t("settlement.sameUser"), variant: "destructive" });
      return;
    }

    saveMutation.mutate({
      fromUserId: selectedFromId,
      toUserId: selectedToId,
      amount: parseFloat(String(amount).replace(',', '.')),
      method,
      notes: notes.trim() || undefined,
      date: initialData ? initialData.date : (draft?.date ? draft.date.toISOString() : new Date().toISOString()),
    });
  };

  return (
    <>
      <Drawer open={isOpen} onOpenChange={onClose}>
        <DrawerContent
          data-testid="modal-settlement"
          onCloseAutoFocus={(event) => {
            if (event.defaultPrevented) return;
          }}
        >
          <DrawerHeader>
            <DrawerTitle className="text-center">
              {initialData ? t("settlement.editTitle") : (draft ? t("settlement.reviewDraftTitle", "Review Settlement") : t("settlement.title"))}
            </DrawerTitle>
            <DrawerDescription className="text-center">
              {initialData ? t("settlement.editDesc") : (draft ? t("settlement.reviewDraftDesc", "Confirm or adjust transfer details.") : t("settlement.desc"))}
            </DrawerDescription>
          </DrawerHeader>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {draft && (
              <div className="mb-4 p-3 rounded-xl bg-primary/5 border border-primary/20 space-y-1 text-left" data-testid="settlement-draft-banner">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-semibold text-primary flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-primary" />
                    {t("agent.draftReviewTitle", "Draft Review")}
                  </span>
                  {draftMeta?.rawInput && (
                    <span className="truncate max-w-[180px] italic">"{draftMeta.rawInput}"</span>
                  )}
                </div>
                {draftMeta?.ambiguities && draftMeta.ambiguities.length > 0 && (
                  <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{t("agent.draftAmbiguityWarning", "Some details were unclear. Please review the prefilled values below.")}</span>
                  </div>
                )}
              </div>
            )}

            <form id="settlement-form" onSubmit={handleSubmit} className="space-y-4" data-testid="form-settlement">
              <div className="flex items-center justify-between gap-2 py-6 px-2 bg-muted/20 rounded-2xl relative border border-border/50">
                <div className="flex-1">
                  <Select value={selectedFromId} onValueChange={setSelectedFromId}>
                    <SelectTrigger className="h-auto p-0 border-none bg-transparent hover:bg-transparent shadow-none focus:ring-0 flex flex-col items-center gap-2">
                      <div className="w-16 h-16 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center text-xl font-bold text-primary shadow-sm">
                        {fromMember?.name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || "?"}
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-semibold truncate max-w-[100px]">{fromMember?.name || t("settlement.whoPaid")}</div>
                        <div className="text-[10px] uppercase tracking-tighter text-muted-foreground font-medium">{t("settlement.payer")}</div>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {users.map(u => (
                        <SelectItem key={u.userId} value={u.userId}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-11 z-10">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-full bg-background shadow-sm border-border hover:bg-muted"
                    onClick={handleSwap}
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 text-primary" />
                  </Button>
                </div>

                <div className="flex-1">
                  <Select value={selectedToId} onValueChange={setSelectedToId}>
                    <SelectTrigger className="h-auto p-0 border-none bg-transparent hover:bg-transparent shadow-none focus:ring-0 flex flex-col items-center gap-2">
                      <div className="w-16 h-16 rounded-full bg-secondary/50 border-2 border-border flex items-center justify-center text-xl font-bold text-foreground shadow-sm">
                        {toMember?.name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || "?"}
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-semibold truncate max-w-[100px]">{toMember?.name || t("settlement.whoReceived")}</div>
                        <div className="text-[10px] uppercase tracking-tighter text-muted-foreground font-medium">{t("settlement.receiver")}</div>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {users.map(u => (
                        <SelectItem key={u.userId} value={u.userId}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="amount">{t("expenseForm.amount")}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-muted-foreground">$</span>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    className="pl-8"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    data-testid="input-settlement-amount"
                  />
                </div>
                {!initialData && suggestedAmount > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("settlement.suggested")}: ${suggestedAmount.toFixed(2)}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="method">{t("settlement.method")}</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger data-testid="select-payment-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="venmo">Venmo</SelectItem>
                    <SelectItem value="paypal">PayPal</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="notes">{t("settlement.notes")}</Label>
                <Textarea
                  id="notes"
                  rows={2}
                  placeholder={t("settlement.notesPlaceholder")}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  data-testid="textarea-settlement-notes"
                />
              </div>
            </form>
          </div>

          {/* Sticky Footer */}
          <DrawerFooter className="border-t bg-background space-y-2">
            {draft && onRefineWithAi && !draftMeta?.isAiEscalated && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs gap-1.5 h-8 border-dashed"
                onClick={onRefineWithAi}
                disabled={isRefiningWithAi || saveMutation.isPending}
                data-testid="button-refine-settlement-ai"
              >
                {isRefiningWithAi ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5 text-primary" />
                )}
                {t("agent.refineWithAi", "Not quite right? Refine with AI")}
              </Button>
            )}

            <div className="flex gap-3">
              {initialData && (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="shrink-0"
                  onClick={() => setShowDeleteConfirm(true)}
                  title={t("common.delete")}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}

              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={onClose}
                data-testid="button-cancel-settlement"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                form="settlement-form"
                className="flex-1"
                disabled={saveMutation.isPending}
                data-testid="button-record-payment"
              >
                {saveMutation.isPending ? t("expenseForm.saving") : (initialData ? t("settlement.update") : t("settlement.record"))}
              </Button>
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settlement.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settlement.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
