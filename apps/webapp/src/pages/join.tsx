import { useState, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { Member, UserSettings } from "@quozen/core";
import { useAuth } from "@/context/auth-provider";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, CheckCircle2, ExternalLink, Search, ChevronDown, User, Check, LogIn, FolderLock } from "lucide-react";
import { useAppContext } from "@/context/app-context";
import { useTranslation } from "react-i18next";
import { useGooglePicker } from "@/hooks/use-google-picker";
import { cn } from "@/lib/utils";

export default function JoinPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user, isAuthenticated, isLoading: authLoading, login, logout } = useAuth();
    const { setActiveGroupId } = useAppContext();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { t } = useTranslation();

    const [error, setError] = useState<string | null>(null);
    const [hasOpenedDrive, setHasOpenedDrive] = useState(false);
    const [showExistingAccounts, setShowExistingAccounts] = useState(false);
    const [existingAccounts, setExistingAccounts] = useState<Member[]>([]);
    const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
    const [accountsError, setAccountsError] = useState<string | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [isSessionExpired, setIsSessionExpired] = useState(false);
    const connectingFromAccountsRef = useRef(false);

    const groupName = searchParams.get("name") || "Group";
    const inviterName = searchParams.get("inviter") || "Someone";

    const joinMutation = useMutation({
        mutationFn: async (options?: { accountId?: string }) => {
            if (!id) throw new Error("Invalid Link");
            if (!user) throw new Error("Authentication required");
            return options?.accountId
                ? await quozen.groups.joinGroup(id, { accountId: options.accountId })
                : await quozen.groups.joinGroup(id);
        },
        onSuccess: (group, variables) => {
            // Optimistic update: Update local cache immediately so App.tsx sees the group as valid
            // before the network request for settings completes. Prevents race-condition redirects.
            if (user?.email) {
                queryClient.setQueryData<UserSettings>(["drive", "settings", user.email], (old) => {
                    if (!old) return old;

                    const exists = old.groupCache.some(g => g.id === group.id);
                    const newCache = exists
                        ? old.groupCache.map(g =>
                            g.id === group.id && variables?.accountId
                                ? { ...g, accountId: variables.accountId }
                                : g
                        )
                        : [{
                            id: group.id,
                            name: group.name,
                            role: (group.isOwner ? "owner" : "member") as "owner" | "member",
                            ...(variables?.accountId ? { accountId: variables.accountId } : {}),
                            lastAccessed: new Date().toISOString()
                        }, ...old.groupCache];

                    return {
                        ...old,
                        activeGroupId: group.id,
                        groupCache: newCache
                    };
                });
            }

            // Trigger actual refresh in background
            queryClient.invalidateQueries({ queryKey: ["drive", "settings"] });
            queryClient.invalidateQueries({ queryKey: ["drive", "group", group.id] });

            setActiveGroupId(group.id);

            toast({
                title: t("join.successTitle"),
                description: t("join.successDesc", { name: group.name }),
            });

            setTimeout(() => navigate("/dashboard"), 1000);
        },
        onError: (err: any) => {
            console.error("Join failed", err);
            const errMsg = String(err?.message || err);
            if (errMsg.includes("401") || errMsg.includes("Session expired") || errMsg.includes("unauthorized") || errMsg.includes("Unauthorized")) {
                logout();
                setIsSessionExpired(true);
                return;
            }
            if (errMsg.includes("403") || errMsg.includes("permission") || errMsg.includes("Forbidden") || errMsg.includes("404")) {
                setError(t("join.accessDenied"));
            } else {
                setError(errMsg || t("join.genericError"));
            }
        }
    });

    const handleToggleExistingAccounts = async () => {
        if (showExistingAccounts) {
            setShowExistingAccounts(false);
            return;
        }
        setShowExistingAccounts(true);
        if (existingAccounts.length > 0 || !id) return;

        setIsLoadingAccounts(true);
        setAccountsError(null);
        try {
            const res = await quozen.groups.validateQuozenSpreadsheet(id);
            if (!res.valid) {
                const errMsg = String(res.error || "");
                if (errMsg.includes("401") || errMsg.includes("Session expired") || errMsg.includes("unauthorized") || errMsg.includes("Unauthorized")) {
                    logout();
                    setIsSessionExpired(true);
                    return;
                }
                if (errMsg.includes("403") || errMsg.includes("permission") || errMsg.includes("Forbidden") || errMsg.includes("404")) {
                    setAccountsError(t("join.accessDenied"));
                } else {
                    setAccountsError(errMsg || t("join.genericError"));
                }
                return;
            }
            setExistingAccounts(res.members || []);
        } catch (err: any) {
            const errMsg = String(err?.message || err);
            if (errMsg.includes("401") || errMsg.includes("Session expired") || errMsg.includes("unauthorized") || errMsg.includes("Unauthorized")) {
                logout();
                setIsSessionExpired(true);
                return;
            }
            setAccountsError(errMsg || t("join.genericError"));
        } finally {
            setIsLoadingAccounts(false);
        }
    };

    const { openPicker } = useGooglePicker({
        // Search by name if available, fallback to ID. Name is better for user recognition in picker.
        // But ID search in picker is flaky if file is not indexed. 
        // Strategy: User clicks Link -> File added to "Recent" -> Picker searches by name -> User picks.
        query: groupName !== "Group" ? groupName : undefined,
        onPick: async (doc) => {
            if (doc.id === id) {
                setError(null);
                setAccountsError(null);
                if (connectingFromAccountsRef.current) {
                    connectingFromAccountsRef.current = false;
                    setIsLoadingAccounts(true);
                    try {
                        const res = await quozen.groups.validateQuozenSpreadsheet(id);
                        if (res.valid) {
                            setExistingAccounts(res.members || []);
                        } else {
                            setAccountsError(t("join.accessDenied"));
                        }
                    } catch (err: any) {
                        const errMsg = String(err?.message || err);
                        setAccountsError(errMsg || t("join.genericError"));
                    } finally {
                        setIsLoadingAccounts(false);
                    }
                } else {
                    // Retry mutation now that we presumably have permission
                    joinMutation.mutate(selectedAccountId ? { accountId: selectedAccountId } : undefined);
                }
            } else {
                toast({ title: t("common.error"), description: t("join.idMismatch"), variant: "destructive" });
            }
        },
        onCancel: () => {
            connectingFromAccountsRef.current = false;
        }
    });

    const driveUrl = id ? `https://docs.google.com/spreadsheets/d/${id}` : "#";

    const selectedAccountName = selectedAccountId
        ? existingAccounts.find(m => m.userId === selectedAccountId)?.name || selectedAccountId
        : user?.name || user?.email || "User";

    // 1. Unauthenticated or Expired Session State: Direct Google Sign-In on Join Page
    if (!isAuthenticated || isSessionExpired) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <Card className="w-full max-w-md shadow-lg border-t-4 border-t-primary animate-in fade-in zoom-in-95 duration-200">
                    <CardContent className="pt-8 pb-8 flex flex-col items-center text-center space-y-6">
                        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-2">
                            <LogIn className="w-8 h-8 text-primary" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-2xl font-bold">
                                {isSessionExpired ? t("join.sessionExpiredTitle") : t("join.signInTitle")}
                            </h2>
                            <p className="text-muted-foreground text-sm max-w-sm">
                                {isSessionExpired
                                    ? t("join.sessionExpiredDesc", { groupName })
                                    : t("join.signInDesc", { inviter: inviterName, groupName })}
                            </p>
                        </div>

                        <Button
                            size="lg"
                            className="w-full h-12 flex items-center justify-center gap-3 font-semibold shadow-md"
                            data-testid="button-join-signin"
                            disabled={authLoading}
                            onClick={() => {
                                setIsSessionExpired(false);
                                setError(null);
                                login();
                            }}
                        >
                            <img
                                src="https://www.google.com/favicon.ico"
                                alt="Google"
                                className="w-4 h-4"
                            />
                            {t("join.signInWithGoogle")}
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // 2. Welcome State (Pre-join selection)
    if (!joinMutation.isPending && !joinMutation.isSuccess && !error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <Card className="w-full max-w-md shadow-lg border-t-4 border-t-primary">
                    <CardContent className="pt-8 pb-8 flex flex-col items-center text-center space-y-6">
                        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-2">
                            <CheckCircle2 className="w-8 h-8 text-primary" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-2xl font-bold">{t("join.welcomeTitle")}</h2>
                            <p className="text-muted-foreground text-base">
                                {t("join.welcomeDesc", { inviter: inviterName, groupName })}
                            </p>
                        </div>

                        {/* Account Selection */}
                        <div className="w-full space-y-3 text-left">
                            {/* Personal Account Option */}
                            <button
                                type="button"
                                onClick={() => setSelectedAccountId(null)}
                                data-testid="select-personal-account"
                                className={cn(
                                    "w-full p-3 rounded-lg border text-left transition-all flex items-center justify-between",
                                    selectedAccountId === null
                                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                                        : "border-border hover:bg-muted/40"
                                )}
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className={cn(
                                        "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                        selectedAccountId === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                    )}>
                                        <User className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0 truncate">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-sm text-foreground truncate">
                                                {user?.name || user?.email || t("join.personalAccount")}
                                            </span>
                                            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium shrink-0">
                                                {t("join.personalAccount")}
                                            </span>
                                        </div>
                                        <p className="text-xs text-muted-foreground truncate">
                                            {t("join.personalAccountDesc", { name: user?.name || user?.email || "you" })}
                                        </p>
                                    </div>
                                </div>
                                {selectedAccountId === null && (
                                    <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0 ml-2">
                                        <Check className="w-3 h-3 text-primary-foreground" />
                                    </div>
                                )}
                            </button>

                            {/* Existing Accounts Option Toggle */}
                            <div className="w-full pt-1">
                                <button
                                    type="button"
                                    onClick={handleToggleExistingAccounts}
                                    data-testid="button-use-existing-account"
                                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    <span>{t("join.useExistingAccount")}</span>
                                    <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showExistingAccounts && "rotate-180")} />
                                </button>

                                {showExistingAccounts && (
                                    <div className="mt-3 text-left space-y-2" data-testid="existing-accounts-list">
                                        <p className="text-xs text-muted-foreground">
                                            {t("join.selectExistingAccountDesc")}
                                        </p>
                                        {isLoadingAccounts ? (
                                            <div className="flex items-center justify-center py-4 text-xs text-muted-foreground gap-2">
                                                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                                <span>{t("join.loadingAccounts")}</span>
                                            </div>
                                        ) : accountsError ? (
                                            accountsError === t("join.accessDenied") ? (
                                                <div className="p-3.5 rounded-lg border border-primary/20 bg-primary/5 space-y-3 text-left" data-testid="connect-drive-prompt">
                                                    <div className="flex items-start gap-2.5">
                                                        <FolderLock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                                                        <div className="space-y-1">
                                                            <p className="text-xs font-semibold text-foreground">
                                                                {t("join.confirmAccessTitle", { groupName })}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground leading-relaxed">
                                                                {t("join.confirmAccessDesc", { inviter: inviterName, groupName })}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        className="w-full flex items-center justify-center gap-2 text-xs font-semibold h-8 shadow-sm"
                                                        data-testid="button-connect-drive-accounts"
                                                        onClick={() => {
                                                            connectingFromAccountsRef.current = true;
                                                            openPicker();
                                                        }}
                                                    >
                                                        <Search className="w-3.5 h-3.5" />
                                                        {t("join.connectWithDrive")}
                                                    </Button>
                                                    {user?.email && (
                                                        <p className="text-[11px] text-muted-foreground text-center">
                                                            {t("join.confirmAccessHint", { email: user.email, inviter: inviterName })}
                                                        </p>
                                                    )}
                                                    <div className="pt-1 text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                                                        <span>{t("join.cantFindFile")}</span>
                                                        <a
                                                            href={driveUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-primary hover:underline inline-flex items-center gap-0.5 font-medium"
                                                        >
                                                            {t("join.openInDriveFirst")}
                                                            <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="p-3 text-xs text-destructive bg-destructive/10 rounded-md">
                                                    {accountsError}
                                                </div>
                                            )
                                        ) : existingAccounts.length === 0 ? (
                                            <div className="p-3 text-xs text-muted-foreground bg-muted/40 rounded-md text-center">
                                                {t("join.noExistingAccounts")}
                                            </div>
                                        ) : (
                                            <div className="space-y-1.5">
                                                {existingAccounts.map((m) => {
                                                    const isSelected = selectedAccountId === m.userId;
                                                    return (
                                                        <button
                                                            key={m.userId}
                                                            type="button"
                                                            onClick={() => setSelectedAccountId(m.userId)}
                                                            data-testid={`join-existing-account-${m.userId}`}
                                                            className={cn(
                                                                "w-full p-2.5 rounded-md border text-left transition-all flex items-center justify-between text-sm",
                                                                isSelected
                                                                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                                                                    : "border-border hover:bg-muted/40"
                                                            )}
                                                        >
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <User className={cn("w-4 h-4 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                                                                <div className="truncate">
                                                                    <span className="font-medium text-foreground">{m.name}</span>
                                                                    {m.email && (
                                                                        <span className="text-xs text-muted-foreground ml-1.5 truncate">({m.email})</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 shrink-0">
                                                                {m.role === "owner" && (
                                                                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                                                                        {t("roles.owner")}
                                                                    </span>
                                                                )}
                                                                {isSelected && (
                                                                    <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                                                                        <Check className="w-2.5 h-2.5 text-primary-foreground" />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Primary Submit Button */}
                        <Button
                            size="lg"
                            className="w-full font-semibold shadow-md"
                            data-testid="button-join-group"
                            disabled={joinMutation.isPending || isLoadingAccounts}
                            onClick={() => joinMutation.mutate(selectedAccountId ? { accountId: selectedAccountId } : undefined)}
                        >
                            {selectedAccountId
                                ? t("join.joinAsAccount", { name: selectedAccountName })
                                : t("join.joinButton")}
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md shadow-lg border-t-4 border-t-primary">
                <CardContent className="pt-8 pb-8 flex flex-col items-center text-center space-y-4">

                    {(authLoading || joinMutation.isPending) && (
                        <>
                            <Loader2 className="w-12 h-12 text-primary animate-spin" />
                            <div>
                                <h2 className="text-xl font-semibold">{t("join.loadingTitle")}</h2>
                                <p className="text-muted-foreground text-sm">{t("join.loadingDesc")}</p>
                            </div>
                        </>
                    )}

                    {joinMutation.isSuccess && (
                        <>
                            <CheckCircle2 className="w-12 h-12 text-green-500" />
                            <div>
                                <h2 className="text-xl font-semibold">{t("join.successTitle")}</h2>
                                <p className="text-muted-foreground text-sm">{t("join.successDesc", { name: joinMutation.data?.name || "" })}</p>
                            </div>
                        </>
                    )}

                    {error && (
                        <>
                            <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center">
                                <AlertCircle className="w-6 h-6 text-destructive" />
                            </div>

                            {error === t("join.accessDenied") ? (
                                <div className="space-y-6 w-full py-4">
                                    <div className="text-center mb-4">
                                        <h2 className="text-lg font-semibold">{t("join.accessRequired")}</h2>
                                        <p className="text-muted-foreground text-xs mt-1 px-4">{t("join.accessRequiredDesc")}</p>
                                    </div>

                                    <div className="relative">
                                        {/* Step 1 */}
                                        <div className="flex gap-4 relative">
                                            <div className="flex flex-col items-center">
                                                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center relative z-10 shrink-0 shadow-sm">
                                                    <ExternalLink className="w-5 h-5 text-primary-foreground" />
                                                </div>
                                                <div className="w-[2px] flex-1 bg-border my-1" />
                                            </div>
                                            <div className="flex-1 pb-8 text-left">
                                                <div className="flex flex-col items-start gap-1">
                                                    <h3 className="font-bold text-foreground text-sm uppercase tracking-tight">{t("join.step1")}</h3>
                                                    <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{t("join.step1Desc")}</p>
                                                    <Button variant="outline" size="sm" className="h-9 px-4 font-semibold text-primary border-primary/20 hover:bg-primary/5" asChild onClick={() => setHasOpenedDrive(true)}>
                                                        <a href={driveUrl} target="_blank" rel="noopener noreferrer">
                                                            {t("join.openButton")}
                                                        </a>
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Step 2 */}
                                        <div className={cn("flex gap-4 transition-all duration-300", !hasOpenedDrive && "opacity-50 grayscale")}>
                                            <div className="flex flex-col items-center">
                                                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center relative z-10 shrink-0 shadow-sm", hasOpenedDrive ? "bg-primary" : "bg-muted")}>
                                                    <Search className={cn("w-5 h-5", hasOpenedDrive ? "text-primary-foreground" : "text-muted-foreground")} />
                                                </div>
                                            </div>
                                            <div className="flex-1 text-left">
                                                <div className="flex flex-col items-start gap-1">
                                                    <h3 className="font-bold text-foreground text-sm uppercase tracking-tight">{t("join.step2")}</h3>
                                                    <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{t("join.step2Desc")}</p>
                                                    <Button
                                                        size="sm"
                                                        className="h-9 px-4 font-semibold shadow-md"
                                                        onClick={() => openPicker()}
                                                        disabled={!hasOpenedDrive}
                                                    >
                                                        {t("join.selectButton")}
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <h2 className="text-xl font-semibold">{t("join.errorTitle")}</h2>
                                    <p className="text-muted-foreground text-sm mt-2">{error}</p>
                                    <Button className="mt-4" onClick={() => window.location.reload()}>
                                        {t("join.tryAgain")}
                                    </Button>
                                    <div className="mt-2"><Button variant="link" onClick={() => navigate("/dashboard")}>{t("join.goHome")}</Button></div>
                                </div>
                            )}
                        </>
                    )}

                </CardContent>
            </Card>
        </div>
    );
}
