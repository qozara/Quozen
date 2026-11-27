import { useState, useEffect, useMemo, useRef } from "react";
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
  inferCategoryFromText,
  humanizeCategoryId,
  ExpenseDraft
} from "@quozen/core";
import {
  CategoryIcon,
  getCategoryDisplayName,
  resolveCategoryMeta,
  useCurrentLocale
} from "@/components/category-icon";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useOptionalAuth } from "@/context/auth-provider";
import { Zap, AlertTriangle, AlertCircle, Sparkles } from "lucide-react";

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

type ExpenseFormField = "category" | "description" | "amount" | "paidBy" | "date" | "splits";
type ExpenseFormErrors = Partial<Record<ExpenseFormField, string>>;

interface ExpenseFormProps {
  initialData?: Partial<Expense>;
  draft?: ExpenseDraft;
  draftMeta?: {
    rawInput?: string;
    isAiEscalated?: boolean;
    ambiguities?: string[];
  } | null;
  users: Member[];
  categories?: ExpenseCategory[];
  currentUserId: string;
  onSubmit: (data: Partial<Expense>) => void;
  onCategoryChange?: (categoryId: string) => void;
  isPending: boolean;
  onCancel?: () => void;
  isDrawer?: boolean;
}

export default function ExpenseForm({
  initialData,
  draft,
  draftMeta,
  users,
  categories,
  currentUserId,
  onSubmit,
  onCategoryChange,
  isPending,
  isDrawer
}: ExpenseFormProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const activeLocale = useCurrentLocale();
  const auth = useOptionalAuth();
  const authUser = auth?.user;

  const availableCategories = categories !== undefined ? categories : DEFAULT_CATEGORIES;
  const targetCategory = draft?.category || initialData?.category;
  const initialCatId = targetCategory
    ? resolveCategory(targetCategory, availableCategories)?.id || targetCategory
    : "";

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

  const resolvedDefaultPaidBy = useMemo(() => {
    if (!users.length) return currentUserId;
    const normId = (currentUserId || "").trim().toLowerCase();
    const matched =
      users.find(u => u.userId === currentUserId) ||
      (normId ? users.find(u => u.email && u.email.trim().toLowerCase() === normId) : undefined) ||
      (authUser?.email ? users.find(u => u.email === authUser.email) : undefined) ||
      users[0];
    return matched?.userId || currentUserId;
  }, [users, currentUserId, authUser?.email]);

  const [description, setDescription] = useState(draft?.description || initialData?.description || "");
  const [amount, setAmount] = useState(
    draft?.amount ? draft.amount.toString() : (initialData?.amount?.toString() || "")
  );
  const [paidBy, setPaidBy] = useState(
    draft?.paidByUserId || initialData?.paidByUserId || (initialData as any)?.paidBy || resolvedDefaultPaidBy
  );
  const [category, setCategory] = useState(initialCatId);
  const [hasManualCategory, setHasManualCategory] = useState(false);
  const [isAutoDetected, setIsAutoDetected] = useState(false);
  const [errors, setErrors] = useState<ExpenseFormErrors>({});
  const [editedFields, setEditedFields] = useState<Partial<Record<ExpenseFormField, boolean>>>({});
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const pillRailRef = useRef<HTMLDivElement | null>(null);
  const pillRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const descriptionInputRef = useRef<HTMLInputElement | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const paidByTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const splitsSectionRef = useRef<HTMLDivElement | null>(null);
  const isInitialMountRef = useRef(true);
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
    if (targetCategory && !hasManualCategory && !isAutoDetected) {
      const resolved = resolveCategory(targetCategory, availableCategories);
      setCategory(resolved ? resolved.id : targetCategory);
    }
  }, [targetCategory, availableCategories, hasManualCategory, isAutoDetected]);

  useEffect(() => {
    if (!isInitialMountRef.current || category) {
      onCategoryChange?.(category);
    }
    if (category) {
      const rail = pillRailRef.current;
      const pill = pillRefs.current[category];
      if (rail && pill && rail.scrollWidth > rail.clientWidth) {
        const reducedMotion =
          isInitialMountRef.current ||
          (typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
        pill.scrollIntoView?.({
          behavior: reducedMotion ? "auto" : "smooth",
          inline: "nearest",
          block: "nearest",
        });
      }
    }
    isInitialMountRef.current = false;
  }, [category, onCategoryChange]);

  const clearFieldError = (field: ExpenseFormField) => {
    setErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setLiveAnnouncement("");
  };

  const markFieldEdited = (field: ExpenseFormField) => {
    setEditedFields(prev => (prev[field] ? prev : { ...prev, [field]: true }));
  };

  const getFieldValidationError = (
    field: ExpenseFormField,
    overrides?: {
      category?: string;
      description?: string;
      amount?: string;
      paidBy?: string;
      date?: string;
      splits?: ExpenseSplit[];
    }
  ): string | undefined => {
    const valCategory = overrides?.category ?? category;
    const valDescription = overrides?.description ?? description;
    const valAmount = overrides?.amount ?? amount;
    const valPaidBy = overrides?.paidBy ?? paidBy;
    const valDate = overrides?.date ?? date;
    const valSplits = overrides?.splits ?? splits;

    switch (field) {
      case "category":
        return !valCategory.trim()
          ? t("expenseForm.errors.categoryRequired", "Please select a category.")
          : undefined;
      case "description":
        return !valDescription.trim()
          ? t("expenseForm.errors.descriptionRequired", "Please enter a description.")
          : undefined;
      case "amount": {
        if (!valAmount || !valAmount.trim()) {
          return t("expenseForm.errors.amountRequired", "Please enter an amount.");
        }
        const parsed = parseFloat(String(valAmount).replace(",", "."));
        if (isNaN(parsed) || parsed <= 0) {
          return t("expenseForm.errors.amountInvalid", "Please enter a valid amount greater than 0.");
        }
        return undefined;
      }
      case "paidBy":
        return !valPaidBy
          ? t("expenseForm.errors.paidByRequired", "Please select who paid.")
          : undefined;
      case "date":
        return !valDate
          ? t("expenseForm.errors.dateRequired", "Please select a date.")
          : undefined;
      case "splits": {
        const selected = valSplits.filter(s => s.selected);
        if (selected.length === 0) {
          return t("expenseForm.invalidSplitDesc");
        }
        const parsed = parseFloat(String(valAmount).replace(",", "."));
        if (!isNaN(parsed) && parsed > 0) {
          const totalSplit = valSplits.reduce((sum, s) => sum + (s.selected ? s.amount : 0), 0);
          if (Math.abs(totalSplit - parsed) > 0.05) {
            return t("expenseForm.splitMismatchDesc");
          }
        }
        return undefined;
      }
    }
  };

  const handleFieldBlur = (field: ExpenseFormField, label: string) => {
    if (!editedFields[field]) return;
    const error = getFieldValidationError(field);
    if (error) {
      setErrors(prev => ({ ...prev, [field]: error }));
      setLiveAnnouncement(`${label}: ${error}`);
    } else {
      clearFieldError(field);
    }
  };

  const handleCategoryChange = (val: string) => {
    const resolved = resolveCategory(val, displayCategories);
    const nextId = resolved ? resolved.id : val;
    setCategory(nextId);
    if (nextId) {
      clearFieldError("category");
    }
  };

  const handleManualCategorySelect = (val: string) => {
    setHasManualCategory(true);
    setIsAutoDetected(false);
    handleCategoryChange(val);
  };

  const handleCategoryKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (displayCategories.length === 0) return;
    let nextIndex = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % displayCategories.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + displayCategories.length) % displayCategories.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = displayCategories.length - 1;
    }
    if (nextIndex >= 0) {
      e.preventDefault();
      const nextCat = displayCategories[nextIndex];
      handleManualCategorySelect(nextCat.id);
      pillRefs.current[nextCat.id]?.focus();
    }
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    markFieldEdited("description");
    if (errors.description && value.trim()) {
      clearFieldError("description");
    }
    if (!initialData && !draft?.category && !hasManualCategory && categories && categories.length > 0) {
      const inferred = inferCategoryFromText(value, displayCategories);
      if (inferred) {
        setCategory(inferred.id);
        setIsAutoDetected(true);
        clearFieldError("category");
      } else if (isAutoDetected) {
        setCategory("");
        setIsAutoDetected(false);
      }
    }
  };

  const activeCategoryDisplayName = useMemo(
    () => getCategoryDisplayName(category, displayCategories, activeLocale),
    [category, displayCategories, activeLocale]
  );

  useEffect(() => {
    if (!initialData && !draft && resolvedDefaultPaidBy) {
      if (!paidBy || !users.some(u => u.userId === paidBy) || paidBy === currentUserId) {
        setPaidBy(resolvedDefaultPaidBy);
      }
    }
  }, [resolvedDefaultPaidBy, currentUserId, users, initialData, draft]);

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
    markFieldEdited("amount");
    updateSplitEqually(value, splits);
    if (errors.amount && !getFieldValidationError("amount", { amount: value })) {
      clearFieldError("amount");
    }
    if (errors.splits) {
      clearFieldError("splits");
    }
  };

  const handleSplitSelection = (userId: string, selected: boolean) => {
    const newSplits = splits.map(s => s.userId === userId ? { ...s, selected } : s);
    updateSplitEqually(amount, newSplits);
    if (errors.splits && newSplits.some(s => s.selected)) {
      clearFieldError("splits");
    }
  };

  const handleSplitAmountChange = (userId: string, newAmount: string) => {
    const value = parseFloat(String(newAmount).replace(',', '.')) || 0;
    const nextSplits = splits.map(split =>
      split.userId === userId ? { ...split, amount: value } : split
    );
    setSplits(nextSplits);
    if (errors.splits && !getFieldValidationError("splits", { splits: nextSplits })) {
      clearFieldError("splits");
    }
  };

  const focusFirstInvalidField = (nextErrors: ExpenseFormErrors) => {
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const scrollBehavior: ScrollBehavior = reducedMotion ? "auto" : "smooth";

    if (nextErrors.category) {
      pillRailRef.current?.scrollIntoView?.({ behavior: scrollBehavior, block: "center" });
      if (displayCategories.length > 0) {
        pillRefs.current[displayCategories[0].id]?.focus();
      }
      return;
    }
    if (nextErrors.description) {
      descriptionInputRef.current?.scrollIntoView?.({ behavior: scrollBehavior, block: "center" });
      descriptionInputRef.current?.focus();
      return;
    }
    if (nextErrors.amount) {
      amountInputRef.current?.scrollIntoView?.({ behavior: scrollBehavior, block: "center" });
      amountInputRef.current?.focus();
      return;
    }
    if (nextErrors.paidBy) {
      paidByTriggerRef.current?.scrollIntoView?.({ behavior: scrollBehavior, block: "center" });
      paidByTriggerRef.current?.focus();
      return;
    }
    if (nextErrors.date) {
      dateInputRef.current?.scrollIntoView?.({ behavior: scrollBehavior, block: "center" });
      dateInputRef.current?.focus();
      return;
    }
    if (nextErrors.splits) {
      splitsSectionRef.current?.scrollIntoView?.({ behavior: scrollBehavior, block: "center" });
      splitsSectionRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const fieldsInOrder: ExpenseFormField[] = [
      "category",
      "description",
      "amount",
      "paidBy",
      "date",
      "splits",
    ];
    const nextErrors: ExpenseFormErrors = {};
    for (const field of fieldsInOrder) {
      const err = getFieldValidationError(field);
      if (err) {
        nextErrors[field] = err;
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      focusFirstInvalidField(nextErrors);

      const firstErrorField = fieldsInOrder.find(f => nextErrors[f])!;
      const firstErrorMessage = nextErrors[firstErrorField]!;
      const selectedSplits = splits.filter(s => s.selected);

      let toastTitle = t("expenseForm.missingInfo");
      if (nextErrors.category || nextErrors.description || nextErrors.paidBy || nextErrors.date) {
        toastTitle = t("expenseForm.missingInfo");
      } else if (nextErrors.amount) {
        toastTitle = t("expenseForm.invalidAmount");
      } else if (nextErrors.splits) {
        toastTitle =
          selectedSplits.length === 0
            ? t("expenseForm.invalidSplit")
            : t("expenseForm.splitMismatch");
      }

      toast({
        title: toastTitle,
        description: firstErrorMessage,
        variant: "destructive",
      });
      return;
    }

    setErrors({});
    const expenseAmount = parseFloat(String(amount).replace(',', '.'));
    const finalSplits = splits
      .filter(s => s.selected && s.amount > 0)
      .map(s => ({ userId: s.userId, amount: s.amount }));

    onSubmit({
      description: description.trim(),
      amount: expenseAmount,
      paidByUserId: paidBy,
      category,
      date: new Date(date),
      splits: finalSplits,
    });
  };

  const renderFieldError = (field: ExpenseFormField) => {
    const message = errors[field];
    if (!message) return null;
    return (
      <p
        id={`expense-error-${field}`}
        data-testid={`error-${field}`}
        className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-destructive"
      >
        <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </p>
    );
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

      <form onSubmit={handleSubmit} noValidate className="space-y-6" data-testid="form-expense">
        <div aria-live="polite" className="sr-only">
          {liveAnnouncement}
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label
              id="expense-category-label"
              className={cn(errors.category && "text-destructive")}
            >
              {t("expenseForm.category")} *
            </Label>
            {isAutoDetected && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary"
                data-testid="category-auto-badge"
              >
                <Sparkles className="w-3 h-3" aria-hidden="true" />
                {t("expenseForm.autoCategoryHint", "Auto-matched")}
              </span>
            )}
          </div>
          <div
            ref={pillRailRef}
            role="radiogroup"
            aria-labelledby="expense-category-label"
            aria-required="true"
            aria-invalid={Boolean(errors.category)}
            aria-describedby={errors.category ? "expense-error-category" : undefined}
            data-testid="select-category"
            data-vaul-no-drag=""
            className={cn(
              "flex gap-2 overflow-x-auto pb-1.5 pt-0.5 -mx-1 px-1 snap-x snap-proximity [scrollbar-width:none] [&::-webkit-scrollbar]:hidden transition-colors",
              errors.category && "rounded-xl ring-2 ring-destructive/60 bg-destructive/5 px-1.5 py-1.5"
            )}
          >
            {displayCategories.map((c, idx) => {
              const isSelected = category === c.id;
              const pillMeta = resolveCategoryMeta(c.id, displayCategories, c.icon, activeLocale);
              return (
                <button
                  key={c.id}
                  ref={(el) => {
                    pillRefs.current[c.id] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={isSelected || (!category && idx === 0) ? 0 : -1}
                  data-testid={`category-pill-${c.id}`}
                  onClick={() => handleManualCategorySelect(c.id)}
                  onKeyDown={(e) => handleCategoryKeyDown(e, idx)}
                  className={cn(
                    "snap-start shrink-0 min-h-[44px] px-3.5 py-2 rounded-full text-sm inline-flex items-center gap-2 transition-all duration-150 motion-reduce:transition-none active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    isSelected
                      ? cn("font-semibold border-2 shadow-xs", pillMeta.theme.activePill)
                      : "font-medium border border-border/70 bg-muted/45 hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <pillMeta.IconComponent
                    aria-hidden="true"
                    className={cn(
                      "w-4 h-4 shrink-0",
                      isSelected ? "opacity-100" : "text-muted-foreground"
                    )}
                  />
                  <span>{pillMeta.displayName || c.name}</span>
                </button>
              );
            })}
          </div>
          {renderFieldError("category")}
        </div>
        <div>
          <Label
            htmlFor="description"
            className={cn(errors.description && "text-destructive")}
          >
            {t("expenseForm.description")} *
          </Label>
          <Input
            ref={descriptionInputRef}
            id="description"
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            onBlur={() => handleFieldBlur("description", t("expenseForm.description"))}
            required
            enterKeyHint="next"
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? "expense-error-description" : undefined}
            className={cn(errors.description && "border-destructive focus-visible:ring-destructive")}
            data-testid="input-expense-description"
          />
          {renderFieldError("description")}
        </div>
        <div>
          <Label
            htmlFor="amount"
            className={cn(errors.amount && "text-destructive")}
          >
            {t("expenseForm.amount")} *
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-3 text-muted-foreground">$</span>
            <Input
              ref={amountInputRef}
              id="amount"
              type="number"
              inputMode="decimal"
              enterKeyHint="done"
              step="0.01"
              className={cn("pl-8", errors.amount && "border-destructive focus-visible:ring-destructive")}
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              onBlur={() => handleFieldBlur("amount", t("expenseForm.amount"))}
              required
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={errors.amount ? "expense-error-amount" : undefined}
              data-testid="input-expense-amount"
            />
          </div>
          {renderFieldError("amount")}
        </div>
        <div>
          <Label
            htmlFor="paidBy"
            className={cn(errors.paidBy && "text-destructive")}
          >
            {t("expenseForm.paidBy")} *
          </Label>
          <Select
            value={paidBy}
            onValueChange={(val) => {
              setPaidBy(val);
              if (val) clearFieldError("paidBy");
            }}
          >
            <SelectTrigger
              ref={paidByTriggerRef}
              aria-required="true"
              aria-invalid={Boolean(errors.paidBy)}
              aria-describedby={errors.paidBy ? "expense-error-paidBy" : undefined}
              className={cn(errors.paidBy && "border-destructive focus:ring-destructive")}
              data-testid="select-paid-by"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => <SelectItem key={u.userId} value={u.userId}>{formatUserLabel(u)}</SelectItem>)}
            </SelectContent>
          </Select>
          {renderFieldError("paidBy")}
        </div>
        <div>
          <Label
            htmlFor="date"
            className={cn(errors.date && "text-destructive")}
          >
            {t("expenseForm.date")} *
          </Label>
          <Input
            ref={dateInputRef}
            id="date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              markFieldEdited("date");
              if (errors.date && e.target.value) clearFieldError("date");
            }}
            onBlur={() => handleFieldBlur("date", t("expenseForm.date"))}
            required
            aria-invalid={Boolean(errors.date)}
            aria-describedby={errors.date ? "expense-error-date" : undefined}
            className={cn(errors.date && "border-destructive focus-visible:ring-destructive")}
            data-testid="input-expense-date"
          />
          {renderFieldError("date")}
        </div>
        <div>
          <Label className={cn("mb-3 block", errors.splits && "text-destructive")}>
            {t("expenseForm.splitBetween")}
          </Label>
          <div
            ref={splitsSectionRef}
            tabIndex={-1}
            aria-invalid={Boolean(errors.splits)}
            aria-describedby={errors.splits ? "expense-error-splits" : undefined}
            className={cn(
              "space-y-3 pb-24 outline-none",
              errors.splits && "rounded-xl ring-2 ring-destructive/60 bg-destructive/5 p-2 pb-24"
            )}
          >
            {renderFieldError("splits")}
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
          <Button
            type="submit"
            className="w-full h-12 flex items-center justify-center gap-2.5"
            disabled={isPending}
            data-testid="button-submit-expense"
          >
            <span>{isPending ? t("expenseForm.saving") : t("expenseForm.save")}</span>
            {!isPending && activeCategoryDisplayName && (
              <span
                data-testid="submit-category-badge"
                className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/15 px-2.5 py-0.5 text-xs font-medium text-primary-foreground"
              >
                <CategoryIcon
                  categoryId={category}
                  categories={displayCategories}
                  aria-hidden="true"
                  className="w-3.5 h-3.5"
                />
                <span className="truncate max-w-[140px]">{`• ${activeCategoryDisplayName}`}</span>
              </span>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
