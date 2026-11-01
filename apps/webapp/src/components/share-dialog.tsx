import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { quozen } from "@/lib/storage";
import { Copy, Check, Globe, Lock, Loader2, Trash2, UserPlus } from "lucide-react";
import { useAuth } from "@/context/auth-provider";
import { useTranslation } from "react-i18next";
import { useAutoSync } from "@/hooks/use-auto-sync";
import OnlineRequiredDialog from "@/components/online-required-dialog";
import { GroupParticipantsOverview, GroupCollaborator } from "@quozen/core";

interface ShareDialogProps {
    isOpen: boolean;
    onClose: () => void;
    groupId: string;
    groupName: string;
}

export default function ShareDialog({ isOpen, onClose, groupId, groupName }: ShareDialogProps) {
    const { toast } = useToast();
    const { t } = useTranslation();
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const [isPublic, setIsPublic] = useState(false);
    const [copied, setCopied] = useState(false);
    const [inviteEmail, setInviteEmail] = useState("");
    const [isOnlineRequiredOpen, setIsOnlineRequiredOpen] = useState(false);

    let autoSync: any;
    try {
        autoSync = useAutoSync();
    } catch {
        // Fallback for isolated test environments
    }
    const isOnline = autoSync?.isOnline ?? (typeof navigator !== "undefined" ? navigator.onLine !== false : true);

    // Construct link with metadata for better UX
    const joinUrl = new URL(`${window.location.origin}/join/${groupId}`);
    if (groupName) joinUrl.searchParams.set("name", groupName);
    if (user?.name) joinUrl.searchParams.set("inviter", user.name);

    const joinLink = joinUrl.toString();

    // Fetch permission status when dialog opens
    const { data: permissionStatus } = useQuery({
        queryKey: ["drive", "permissions", groupId],
        queryFn: () => quozen.groups.getGroupPermissions(groupId),
        enabled: isOpen && !!groupId && isOnline,
    });

    // Fetch full participants & collaborators overview
    const { data: participantsData } = useQuery<GroupParticipantsOverview>({
        queryKey: ["group-participants", groupId],
        queryFn: () => quozen.groups.getGroupParticipants(groupId),
        enabled: isOpen && !!groupId && isOnline,
    });

    const isCurrentGroupOwner =
        participantsData && Array.isArray(participantsData.collaborators) && user?.email
            ? participantsData.collaborators.some(
                c => c.role === "owner" && c.email.toLowerCase() === user.email.toLowerCase()
              )
            : true;

    useEffect(() => {
        if (typeof permissionStatus === "string") {
            setIsPublic(permissionStatus === "public");
        }
    }, [permissionStatus]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [isOpen, onClose]);

    const permissionMutation = useMutation({
        mutationFn: async (makePublic: boolean) => {
            const access = makePublic ? "public" : "restricted";
            await quozen.groups.setGroupPermissions(groupId, access);
            return makePublic;
        },
        onSuccess: (makePublic) => {
            setIsPublic(makePublic);
            queryClient.setQueryData(["drive", "permissions", groupId], makePublic ? "public" : "restricted");
            queryClient.invalidateQueries({ queryKey: ["group-participants", groupId] });
        },
        onError: () => {
            // Revert state on error
            setIsPublic((prev) => !prev);
            toast({
                title: t("common.error"),
                description: t("share.updateError"),
                variant: "destructive"
            });
        }
    });

    const inviteMutation = useMutation({
        mutationFn: async (emailToInvite: string) => {
            const currentMembers = participantsData?.accounts.map(a => ({
                email: a.member.email,
                username: a.member.name
            })) || [];
            await quozen.groups.updateGroup(
                groupId,
                groupName,
                [...currentMembers, { email: emailToInvite }]
            );
            return emailToInvite;
        },
        onSuccess: (email) => {
            setInviteEmail("");
            toast({
                title: t("common.success"),
                description: t("share.inviteSuccess", { email })
            });
            queryClient.invalidateQueries({ queryKey: ["group-participants", groupId] });
            queryClient.invalidateQueries({ queryKey: ["drive", "group", groupId] });
        },
        onError: (err: any) => {
            toast({
                title: t("common.error"),
                description: err?.message || t("common.genericError"),
                variant: "destructive"
            });
        }
    });

    const revokeMutation = useMutation({
        mutationFn: async (collaborator: GroupCollaborator) => {
            await quozen.groups.removeGroupCollaborator(groupId, collaborator.id);
            return collaborator;
        },
        onSuccess: () => {
            toast({
                title: t("common.success"),
                description: t("share.revokeSuccess")
            });
            queryClient.invalidateQueries({ queryKey: ["group-participants", groupId] });
        },
        onError: (err: any) => {
            toast({
                title: t("common.error"),
                description: err?.message || t("common.genericError"),
                variant: "destructive"
            });
        }
    });

    const handleToggle = (checked: boolean) => {
        if (!isOnline) {
            setIsOnlineRequiredOpen(true);
            return;
        }
        setIsPublic(checked); // Optimistic update
        permissionMutation.mutate(checked);
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(joinLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleInviteSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = inviteEmail.trim().toLowerCase();
        if (!trimmed || !trimmed.includes("@")) return;
        if (!isOnline) {
            setIsOnlineRequiredOpen(true);
            return;
        }
        inviteMutation.mutate(trimmed);
    };

    const handleRevoke = (collaborator: GroupCollaborator) => {
        if (!isOnline) {
            setIsOnlineRequiredOpen(true);
            return;
        }
        if (window.confirm(t("share.confirmRevoke", { name: collaborator.displayName, email: collaborator.email }))) {
            revokeMutation.mutate(collaborator);
        }
    };

    const collaboratorsList = Array.isArray(participantsData?.collaborators)
        ? participantsData.collaborators
        : [];

    const getManagedAccountLabel = (email: string) => {
        if (!participantsData?.accounts || !Array.isArray(participantsData.accounts)) return null;
        const norm = email.toLowerCase();
        const matched = participantsData.accounts.filter(a =>
            Array.isArray(a.managers) && a.managers.some(m => m.email?.toLowerCase() === norm)
        );
        if (matched.length === 0) return null;
        return matched.map(m => m.member.name).join(", ");
    };

    return (
        <>
        <Drawer
            open={isOpen}
            onOpenChange={(open) => {
                if (permissionMutation.isPending || inviteMutation.isPending || revokeMutation.isPending) return;
                if (!open) onClose();
            }}
            dismissible={!permissionMutation.isPending}
        >
            <DrawerContent
                onCloseAutoFocus={(event) => {
                    if (event.defaultPrevented) return;
                }}
            >
                <DrawerHeader>
                    <DrawerTitle data-testid="drawer-title-share">{t("share.title", { name: groupName })}</DrawerTitle>
                    <DrawerDescription>
                        {t("share.description")}
                    </DrawerDescription>
                </DrawerHeader>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-6">
                    {/* General Access Switch */}
                    <div className="flex items-center justify-between space-x-2">
                        <div className="flex flex-col space-y-1">
                            <Label htmlFor="public-access" className="flex items-center gap-2">
                                {isPublic ? <Globe className="w-4 h-4 text-primary" /> : <Lock className="w-4 h-4 text-muted-foreground" />}
                                <span>{t("share.accessLabel")}</span>
                            </Label>
                            <span className="text-xs text-muted-foreground">
                                {isPublic ? t("share.public") : t("share.restricted")}
                            </span>
                        </div>
                        <Switch
                            id="public-access"
                            checked={isPublic}
                            onCheckedChange={handleToggle}
                            disabled={permissionMutation.isPending}
                        />
                    </div>

                    {/* Invite Link Box */}
                    <div className="space-y-2">
                        <Label>{isPublic ? t("share.publicLink") : t("share.restrictedLink")}</Label>
                        <div className="flex items-center space-x-2">
                            <Input
                                readOnly
                                value={joinLink}
                                className="flex-1 bg-muted/50 text-xs font-mono"
                            />
                            <Button size="icon" variant="outline" onClick={handleCopy} title={t("share.copy")}>
                                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {isPublic ? t("share.publicNote") : t("share.restrictedNote")}
                        </p>
                        {!isPublic && (
                            <div className="pt-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full flex items-center justify-center gap-2 text-xs"
                                    onClick={() => handleToggle(true)}
                                    disabled={permissionMutation.isPending}
                                    data-testid="button-enable-public-sharing"
                                >
                                    {permissionMutation.isPending ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                                    ) : (
                                        <Globe className="w-3.5 h-3.5 text-primary" />
                                    )}
                                    {t("share.enablePublicAction")}
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Invite by Email Input */}
                    <div className="space-y-2 border-t pt-4">
                        <Label htmlFor="invite-email">{t("share.peopleWithAccess")}</Label>
                        <form onSubmit={handleInviteSubmit} className="flex gap-2">
                            <Input
                                id="invite-email"
                                type="email"
                                placeholder={t("share.invitePlaceholder")}
                                value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                                className="text-xs flex-1"
                                disabled={inviteMutation.isPending}
                                data-testid="input-invite-email"
                            />
                            <Button
                                type="submit"
                                size="sm"
                                disabled={!inviteEmail.trim() || inviteMutation.isPending}
                                data-testid="button-submit-invite"
                            >
                                {inviteMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <>
                                        <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                                        <span>{t("share.invite")}</span>
                                    </>
                                )}
                            </Button>
                        </form>
                    </div>

                    {/* Collaborator List */}
                    {collaboratorsList.length > 0 && (
                        <div className="space-y-2.5">
                            {collaboratorsList.map((collab) => {
                                const isSelf = Boolean(user?.email && collab.email.toLowerCase() === user.email.toLowerCase());
                                const managedAccount = getManagedAccountLabel(collab.email);
                                const isOwner = collab.role === "owner";

                                return (
                                    <div
                                        key={collab.id || collab.email}
                                        className="flex items-center justify-between p-2.5 rounded-lg border bg-card/60 text-card-foreground text-xs"
                                        data-testid={`collaborator-row-${collab.email}`}
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <Avatar className="w-8 h-8">
                                                {collab.avatarUrl && <AvatarImage src={collab.avatarUrl} alt={collab.displayName} />}
                                                <AvatarFallback className="text-[10px] uppercase font-medium bg-primary/10 text-primary">
                                                    {(collab.displayName || collab.email).slice(0, 2)}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="font-medium truncate max-w-[130px]">
                                                        {collab.displayName || collab.email}
                                                    </span>
                                                    {isSelf && (
                                                        <Badge variant="outline" className="text-[10px] h-4 px-1 py-0">
                                                            {t("share.you")}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <span className="text-[11px] text-muted-foreground truncate max-w-[160px]">
                                                    {collab.email}
                                                </span>
                                                {managedAccount && (
                                                    <span className="text-[10px] text-primary/80 font-medium">
                                                        {t("share.managingAccount", { account: managedAccount })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <Badge
                                                variant={isOwner ? "default" : "secondary"}
                                                className="text-[10px] h-5 capitalize"
                                            >
                                                {isOwner ? t("share.owner") : t("share.editor")}
                                            </Badge>
                                            {isCurrentGroupOwner && !isOwner && !isSelf && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="w-7 h-7 text-muted-foreground hover:text-destructive"
                                                    onClick={() => handleRevoke(collab)}
                                                    title={t("share.revokeAccess")}
                                                    disabled={revokeMutation.isPending}
                                                    data-testid={`button-revoke-${collab.email}`}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <p className="text-[10px] text-muted-foreground pt-1">
                        {t("share.note")}
                    </p>
                </div>
            </DrawerContent>
        </Drawer>
        <OnlineRequiredDialog
            isOpen={isOnlineRequiredOpen}
            onOpenChange={setIsOnlineRequiredOpen}
            reason="changePermissions"
        />
        </>
    );
}
