import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { quozen } from "@/lib/storage";
import { Copy, Check, Globe, Lock } from "lucide-react";
import { useAuth } from "@/context/auth-provider";
import { useTranslation } from "react-i18next";

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

    // Construct link with metadata for better UX
    const joinUrl = new URL(`${window.location.origin}/join/${groupId}`);
    if (groupName) joinUrl.searchParams.set("name", groupName);
    if (user?.name) joinUrl.searchParams.set("inviter", user.name);

    const joinLink = joinUrl.toString();

    // Fetch permission status when dialog opens
    const { data: permissionStatus } = useQuery({
        queryKey: ["drive", "permissions", groupId],
        queryFn: () => quozen.groups.getGroupPermissions(groupId),
        enabled: isOpen && !!groupId,
    });

    useEffect(() => {
        if (permissionStatus) {
            setIsPublic(permissionStatus === 'public');
        }
    }, [permissionStatus]);

    const permissionMutation = useMutation({
        mutationFn: async (makePublic: boolean) => {
            const access = makePublic ? 'public' : 'restricted';
            await quozen.groups.setGroupPermissions(groupId, access);
            return makePublic;
        },
        onSuccess: (makePublic) => {
            setIsPublic(makePublic);
            queryClient.setQueryData(["drive", "permissions", groupId], makePublic ? 'public' : 'restricted');
            toast({
                title: t("common.success"),
                description: makePublic ? t("share.successPublic") : t("share.successRestricted")
            });
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

    const handleToggle = (checked: boolean) => {
        setIsPublic(checked); // Optimistic update
        permissionMutation.mutate(checked);
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(joinLink);
        setCopied(true);
        toast({ description: t("share.copied") });
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Drawer open={isOpen} onOpenChange={onClose}>
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
                <div className="flex-1 overflow-y-auto px-4 pb-8">
                    <div className="space-y-6">
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

                        <div className="space-y-2">
                            <Label>{t("share.magicLink")}</Label>
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
                            <p className="text-[10px] text-muted-foreground">
                                {t("share.note")}
                            </p>
                        </div>
                    </div>
                </div>
            </DrawerContent>
        </Drawer>
    );
}
