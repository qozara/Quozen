import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { Member, UserSettings } from "@quozen/core";
import { useAuth } from "@/context/auth-provider";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, CheckCircle2, ExternalLink, Search, ChevronDown, User } from "lucide-react";
import { useAppContext } from "@/context/app-context";
import { useTranslation } from "react-i18next";
import { useGooglePicker } from "@/hooks/use-google-picker";
import { cn } from "@/lib/utils";

export default function JoinPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const { user, isAuthenticated, isLoading: authLoading } = useAuth();
    const { setActiveGroupId } = useAppContext();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { t } = useTranslation();
    const [error, setError] = useState<string | null>(null);
    const [hasOpenedDrive, setHasOpenedDrive] = useState(false);
    const [showExistingAccounts, setShowExistingAccounts] = useState(false);
    const [existingAccounts, setExistingAccounts] = useState<Member[]>([]);
    const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);

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
            // Handle specific Google API error codes
            const errMsg = err.message || "";
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
        try {
            const res = await quozen.groups.validateQuozenSpreadsheet(id);
            if (!res.valid) {
                const errMsg = res.error || "";
                if (errMsg.includes("403") || errMsg.includes("permission") || errMsg.includes("Forbidden") || errMsg.includes("404")) {
                    setError(t("join.accessDenied"));
                } else {
                    setError(errMsg || t("join.genericError"));
                }
                return;
            }
            setExistingAccounts(res.members || []);
        } catch (err: any) {
            const errMsg = err?.message || "";
            if (errMsg.includes("403") || errMsg.includes("permission") || errMsg.includes("Forbidden") || errMsg.includes("404")) {
                setError(t("join.accessDenied"));
            } else {
                setError(errMsg || t("join.genericError"));
            }
        } finally {
            setIsLoadingAccounts(false);
        }
    };

    useEffect(() => {
        if (authLoading) return;

        if (!isAuthenticated) {
            navigate("/login", {
                state: { from: location, message: t("join.signIn") }
            });
            return;
        }
    }, [isAuthenticated, authLoading, navigate, t, location]);

    const { openPicker } = useGooglePicker({
        // Search by name if available, fallback to ID. Name is better for user recognition in picker.
        // But ID search in picker is flaky if file is not indexed. 
        // Strategy: User clicks Link -> File added to "Recent" -> Picker searches by name -> User picks.
        query: groupName !== "Group" ? groupName : undefined,
        onPick: (doc) => {
            if (doc.id === id) {
                setError(null);
                // Retry mutation now that we presumably have permission
                joinMutation.mutate(undefined);
            } else {
                toast({ title: t("common.error"), description: t("join.idMismatch"), variant: "destructive" });
            }
        }
    });

    const driveUrl = id ? `https://docs.google.com/spreadsheets/d/${id}` : "#";

    // 1. Welcome State (Pre-join)
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
                        <Button
                            size="lg"
                            className="w-full"
                            onClick={() => joinMutation.mutate(undefined)}
                        >
                            {t("join.joinButton")}
                        </Button>

                        <div className="w-full pt-2 border-t border-border/60">
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
                                    <p className="text-xs text-muted-foreground text-center">
                                        {t("join.selectExistingAccountDesc")}
                                    </p>
                                    {isLoadingAccounts ? (
                                        <div className="flex items-center justify-center py-3 text-xs text-muted-foreground gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            <span>{t("join.loadingAccounts")}</span>
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                                            {existingAccounts.map((m) => (
                                                <button
                                                    key={m.userId}
                                                    type="button"
                                                    onClick={() => joinMutation.mutate({ accountId: m.userId })}
                                                    data-testid={`join-existing-account-${m.userId}`}
                                                    className="w-full p-2.5 flex items-center justify-between text-sm hover:bg-muted/60 transition-colors text-left"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <User className="w-4 h-4 text-primary shrink-0" />
                                                        <span className="font-medium">{m.name}</span>
                                                    </div>
                                                    {m.role === "owner" && (
                                                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                                            {t("roles.owner")}
                                                        </span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
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
