import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Expense,
  Member,
  ExpenseCategory,
  DEFAULT_CATEGORIES,
  resolveCategory,
  humanizeCategoryId,
  ExpenseDraft
} from "@quozen/core";
import { CategoryIcon } from "@/components/category-icon";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useOptionalAuth } from "@/context/auth-provider";
import { Zap, AlertTriangle, RefreshCw } from "lucide-react";

const distributeAmount = (total: number, count: number): number[] => {
  if (count <= 0) return [];

  const totalCents = Math.round(total * 100);
  const baseSplitCents = Math.floor(totalCents / count);
  const remainderCents = totalCents % count;

  const results = [];
  for (let i = 0; i < count; i++) {
    let valCents = baseSplitCents;
    if (i < remainderCents) valCents += 1;
    results.push(valCents / 100);
  }

  return results;
};

interface ExpenseSplit {
  userId: string;
  amount: number;
  selected: boolean;
}

interface ExpenseFormProps {
  initialData?: Partial<Expense>;
  draft?: ExpenseDraft;
  draftMeta?: {
    rawInput?: string;
    isAiEscalated?: boolean;
    ambiguities?: string[];
  } | null;
  onRefineWithAi?: () => Promise<void>;
  isRefiningWithAi?: boolean;
  users: Member[];
  categories?: ExpenseCategory[];
  currentUserId: string;
  onSubmit: (data: Partial<Expense>) => void;
  isPending: boolean;
  onCancel?: () => void;
  isDrawer?: boolean;
}

export default function ExpenseForm({
  initialData,
  draft,
  draftMeta,
  onRefineWithAi,
  isRefiningWithAi = false,
  users,
  categories,
  currentUserId,
  onSubmit,
  isPending,
  isDrawer
}: ExpenseFormProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const auth = useOptionalAuth();
  const authUser = auth?.user;

  const availableCategories = categories !== undefined ? categories : DEFAULT_CATEGORIES;
  const targetCategory = draft?.category || initialData?.category;
  const initialCatId = targetCategory
    ? resolveCategory(targetCategory, availableCategories)?.id || targetCategory
    : (categories && categories.length > 0 ? categories[0].id : "");

  const displayCategories = useMemo(() => {
    if (!initialCatId || availableCategories.some(c => c.id === initialCatId)) {
      return availableCategories;
    }
    return [
      ...availableCategories,
      {
        id: initialCatId,
        name: humanizeCategoryId(initialCatId),
        icon: "tag",
        description: "",
      },
    ];
  }, [availableCategories, initialCatId]);

  const [description, setDescription] = useState(draft?.description || initialData?.description || "");
  const [amount, setAmount] = useState(
    draft?.amount ? draft.amount.toString() : (initialData?.amount?.toString() || "")
  );
  const [paidBy, setPaidBy] = useState(
    draft?.paidByUserId || initialData?.paidByUserId || (initialData as any)?.paidBy || currentUserId
  );
  const [category, setCategory] = useState(initialCatId);
  const [date, setDate] = useState(
    draft?.date
      ? new Date(draft.date).toISOString().split('T')[0]
      : (initialData?.date ? new Date(initialData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0])
  );
  const [splits, setSplits] = useState<ExpenseSplit[]>([]);

  // Sync draft updates into state
  useEffect(() => {
    if (draft) {
      if (draft.description) setDescription(draft.description);
      if (draft.amount) setAmount(draft.amount.toString());
      if (draft.paidByUserId) setPaidBy(draft.paidByUserId);
      if (draft.category) {
        const resCat = resolveCategory(draft.category, displayCategories);
        setCategory(resCat ? resCat.id : draft.category);
      }
      if (draft.date) setDate(new Date(draft.date).toISOString().split('T')[0]);
      if (draft.splits && draft.splits.length > 0) {
        setSplits(users.map(u => {
          const s = draft.splits.find(ds => ds.userId === u.userId);
          return {
            userId: u.userId,
            amount: s?.amount || 0,
            selected: s ? s.amount > 0 : false
          };
        }));
      }
    }
  }, [draft, users, displayCategories]);

  useEffect(() => {
    if (!initialData && !draft && categories && categories.length > 0 && (!category || !categories.some(c => c.id === category))) {
      setCategory(categories[0].id);
    }
  }, [category, categories, initialData, draft]);

  const handleCategoryChange = (val: string) => {
    const resolved = resolveCategory(val, displayCategories);
    setCategory(resolved ? resolved.id : val);
  };

  useEffect(() => {
    if (!initialData && !draft && currentUserId) {
      setPaidBy(currentUserId);
    }
  }, [currentUserId, initialData, draft]);

  const formatUserLabel = (u?: Member) => {
    if (!u) return "";
    if (u.userId !== currentUserId) return u.name;
    const isSharedOrOfflineAccount = Boolean(
      authUser &&
        (u.userId !== authUser.id ||
          (authUser.name && u.name !== authUser.name))
    );
    if (isSharedOrOfflineAccount && u.name) {
      return t("expenseForm.youNamed", { name: u.name });
    }
    return t("expenseForm.you");
  };

  useEffect(() => {
    if (users.length > 0 && splits.length === 0) {
      if (draft?.splits && draft.splits.length > 0) {
        const initialSplits = users.map(u => {
          const existingSplit = draft.splits.find(s => s.userId === u.userId);
          return {
            userId: u.userId,
            amount: existingSplit?.amount || 0,
            selected: existingSplit ? existingSplit.amount > 0 : false
          };
        });
        setSplits(initialSplits);
      } else {
        const initialSplits = users.map((u) => {
          const existingSplit = initialData?.splits?.find((s: any) => s.userId === u.userId);
          return {
            userId: u.userId,
            amount: existingSplit?.amount || 0,
            selected: !!existingSplit || !initialData,
          };
        });

        if (!initialData && amount) {
          updateSplitEqually(amount, initialSplits);
        } else {
          setSplits(initialSplits);
        }
      }
    }
  }, [users, initialData, draft]);

  const updateSplitEqually = (currentAmount: string, currentSplits: ExpenseSplit[]) => {
    const selectedSplits = currentSplits.filter(s => s.selected);
    const count = selectedSplits.length;

    if (count === 0) {
      setSplits(currentSplits.map(s => ({ ...s, amount: 0 })));
      return;
    }

    if (!currentAmount) return;

    const totalAmount = parseFloat(String(currentAmount).replace(',', '.'));
    if (isNaN(totalAmount)) return;

    const distributedAmounts = distributeAmount(totalAmount, count);

    let distIndex = 0;
    const newSplits = currentSplits.map(s => {
      if (s.selected) {
        const amt = distributedAmounts[distIndex];
        distIndex++;
        return { ...s, amount: amt };
      }
      return { ...s, amount: 0 };
    });

    setSplits(newSplits);
  };

  const handleAmountChange = (value: string) => {
    setAmount(value);
    updateSplitEqually(value, splits);
  };

  const handleSplitSelection = (userId: string, selected: boolean) => {
    const newSplits = splits.map(s => s.userId === userId ? { ...s, selected } : s);
    updateSplitEqually(amount, newSplits);
  };

  const handleSplitAmountChange = (userId: string, newAmount: string) => {
    const value = parseFloat(String(newAmount).replace(',', '.')) || 0;
    setSplits(prev =>
      prev.map(split =>
        split.userId === userId ? { ...split, amount: value } : split
      )
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!description || !paidBy || !category || !date) {
      toast({
        title: t("expenseForm.missingInfo"),
        description: t("expenseForm.missingInfoDesc"),
        variant: "destructive",
      });
      return;
    }

    const selectedSplits = splits.filter(s => s.selected);
    if (selectedSplits.length === 0) {
      toast({
        title: t("expenseForm.invalidSplit"),
        description: t("expenseForm.invalidSplitDesc"),
        variant: "destructive",
      });
      return;
    }

    const expenseAmount = parseFloat(String(amount).replace(',', '.'));
    if (!amount || isNaN(expenseAmount)) {
      toast({
        title: t("expenseForm.invalidAmount"),
        description: t("expenseForm.invalidAmountDesc"),
        variant: "destructive",
      });
      return;
    }

    const totalSplit = splits.reduce((sum, s) => sum + (s.selected ? s.amount : 0), 0);

    if (Math.abs(totalSplit - expenseAmount) > 0.05) {
      toast({
        title: t("expenseForm.splitMismatch"),
        description: t("expenseForm.splitMismatchDesc"),
        variant: "destructive",
      });
      return;
    }

    const finalSplits = splits
      .filter(s => s.selected && s.amount > 0)
      .map(s => ({ userId: s.userId, amount: s.amount }));

    onSubmit({
      description,
      amount: expenseAmount,
      paidByUserId: paidBy,
      category,
      date: new Date(date),
      splits: finalSplits,
    });
  };

  return (
    <div className={cn("mx-auto", !isDrawer && "mx-4 mt-4 pb-32")}>
      {draft && (
        <div className="mb-4 p-3 rounded-xl bg-primary/5 border border-primary/20 space-y-2" data-testid="draft-confirmation-banner">
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

      <form onSubmit={handleSubmit} className="space-y-6" data-testid="form-expense">
        <div>
          <Label htmlFor="description">{t("expenseForm.description")} *</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            data-testid="input-expense-description"
          />
        </div>
        <div>
          <Label htmlFor="amount">{t("expenseForm.amount")} *</Label>
          <div className="relative">
            <span className="absolute left-3 top-3 text-muted-foreground">$</span>
            <Input
              id="amount"
              type="number"
              step="0.01"
              className="pl-8"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              required
              data-testid="input-expense-amount"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="paidBy">{t("expenseForm.paidBy")} *</Label>
          <Select value={paidBy} onValueChange={setPaidBy}>
            <SelectTrigger data-testid="select-paid-by"><SelectValue /></SelectTrigger>
            <SelectContent>
              {users.map((u) => <SelectItem key={u.userId} value={u.userId}>{formatUserLabel(u)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="category">{t("expenseForm.category")} *</Label>
          <Select value={category} onValueChange={handleCategoryChange}>
            <SelectTrigger data-testid="select-category"><SelectValue placeholder={t("expenseForm.selectCategory")} /></SelectTrigger>
            <SelectContent>
              {displayCategories.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  <div className="flex items-center gap-2">
                    <CategoryIcon iconName={c.icon} categoryId={c.id} categories={displayCategories} className="w-4 h-4 text-muted-foreground" />
                    <span>{c.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="date">{t("expenseForm.date")} *</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="input-expense-date"
          />
        </div>
        <div>
          <Label className="mb-3 block">{t("expenseForm.splitBetween")}</Label>
          <div className="space-y-3 pb-24">
            {splits.map((split) => (
              <div
                key={split.userId}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer",
                  split.selected ? "bg-primary/10 border-primary shadow-xs" : "bg-muted/40 hover:bg-muted/60 border-border/60 shadow-xs"
                )}
                onClick={() => handleSplitSelection(split.userId, !split.selected)}
                data-testid={`split-item-${split.userId}`}
              >
                <div className="flex items-center space-x-3">
                  <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={split.selected}
                      onCheckedChange={(checked) => handleSplitSelection(split.userId, !!checked)}
                      data-testid={`checkbox-split-${split.userId}`}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center shrink-0">
                      <span className="text-primary-foreground font-medium text-xs">
                        {users.find(u => u.userId === split.userId)?.name?.substring(0, 2)}
                      </span>
                    </div>
                    <span className="text-sm font-medium">
                      {formatUserLabel(users.find(u => u.userId === split.userId))}
                    </span>
                  </div>
                </div>
                <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-muted-foreground">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-20 h-8 text-sm"
                    value={split.amount.toFixed(2)}
                    onChange={(e) => handleSplitAmountChange(split.userId, e.target.value)}
                    disabled={!split.selected}
                    data-testid={`input-split-amount-${split.userId}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Footer */}
        <div className={cn(
          "w-full bg-card border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.06)] z-40 p-4 space-y-2",
          isDrawer ? "sticky bottom-0 -mx-4 px-8" : "fixed bottom-0 left-1/2 transform -translate-x-1/2 max-w-md"
        )}>
          {draft && onRefineWithAi && !draftMeta?.isAiEscalated && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs gap-1.5 h-8 border-dashed"
              onClick={onRefineWithAi}
              disabled={isRefiningWithAi || isPending}
              data-testid="button-refine-with-ai"
            >
              {isRefiningWithAi ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5 text-primary" />
              )}
              {t("agent.refineWithAi", "Not quite right? Refine with AI")}
            </Button>
          )}

          <Button
            type="submit"
            className="w-full h-12"
            disabled={isPending}
            data-testid="button-submit-expense"
          >
            {isPending ? t("expenseForm.saving") : t("expenseForm.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
