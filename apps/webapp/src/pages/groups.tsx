import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "@/context/app-context";
import { useAuth } from "@/context/auth-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { quozen } from "@/lib/storage";
import { Users, Plus, Pencil, Shield, User, Trash2, LogOut, Share2, MoreVertical, FolderSearch, Download, AlertCircle } from "lucide-react";
import { MemberInput, Group } from "@quozen/core";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import GroupDialog from "@/components/group-dialog";
import ShareDialog from "@/components/share-dialog";
import { useGroups } from "@/hooks/use-groups";
import { useTranslation } from "react-i18next";
import { useGooglePicker } from "@/hooks/use-google-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function Groups() {
  const { activeGroupId, setActiveGroupId } = useAppContext();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { groups } = useGroups();
  const { t } = useTranslation();

  const [dialogState, setDialogState] = useState<{
    open: boolean;
    mode: "create" | "edit";
    groupId?: string;
    initialName?: string;
    initialMembers?: string;
  }>({ open: false, mode: "create" });

  const [shareDialog, setShareDialog] = useState<{
    open: boolean;
    groupId: string;
    groupName: string;
  }>({ open: false, groupId: "", groupName: "" });

  const [alertState, setAlertState] = useState<{
    open: boolean;
    type: "delete" | "leave";
    group?: Group;
  }>({ open: false, type: "delete" });

  // --- Import Logic (Migrated from Switcher) ---
  const { openPicker, error: pickerError } = useGooglePicker({
    onPick: async (doc) => {
      toast({ title: t("common.loading") });
      if (!user) return;

      try {
        const group = await quozen.groups.importGroup(doc.id);

        await queryClient.invalidateQueries({ queryKey: ["drive", "settings"] });
        await queryClient.invalidateQueries({ queryKey: ["drive", "group", group.id] });

        setActiveGroupId(group.id);
        toast({ title: t("common.success") });
      } catch (e: any) {
        toast({ title: t("common.error"), description: e.message, variant: "destructive" });
      }
    }
  });

  // --- Handlers ---

  const handleEditClick = async (e: React.MouseEvent, group: Group) => {
    e.stopPropagation();
    try {
      const members = await quozen.ledger(group.id).getMembers();
      const editableMembers = members.filter(m => m.role !== 'owner').map(m => m.email || m.userId).join(", ");
      setDialogState({ open: true, mode: "edit", groupId: group.id, initialName: group.name, initialMembers: editableMembers });
    } catch (err) {
      toast({ title: t("common.error"), description: t("groups.loadError"), variant: "destructive" });
    }
  };

  const handleShareClick = (e: React.MouseEvent, group: Group) => {
    e.stopPropagation();
    setShareDialog({ open: true, groupId: group.id, groupName: group.name });
  };

  const handleDeleteClick = (e: React.MouseEvent, group: Group) => {
    e.stopPropagation();
    setAlertState({ open: true, type: "delete", group });
  };

  const handleLeaveClick = (e: React.MouseEvent, group: Group) => {
    e.stopPropagation();
    setAlertState({ open: true, type: "leave", group });
  };

  const openCreateDialog = () => setDialogState({ open: true, mode: "create", initialName: "", initialMembers: "" });

  const createGroupMutation = useMutation({
    mutationFn: async (data: { name: string, members: MemberInput[] }) => {
      if (!user) throw new Error("User not authenticated");
      return await quozen.groups.create(data.name, data.members);
    },
    onSuccess: (newGroup) => {
      queryClient.invalidateQueries({ queryKey: ["drive", "settings"] });
      toast({ title: t("common.success") });
      setDialogState(prev => ({ ...prev, open: false }));
      if (newGroup?.id) {
        setActiveGroupId(newGroup.id);
        setShareDialog({
          open: true,
          groupId: newGroup.id,
          groupName: newGroup.name
        });
      }
    },
    onError: () => toast({ title: t("common.error"), description: t("groups.createError"), variant: "destructive" }),
  });

  const updateGroupMutation = useMutation({
    mutationFn: async (data: { groupId: string, name: string, members: MemberInput[] }) => {
      return await quozen.groups.updateGroup(data.groupId, data.name, data.members);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["drive", "settings"] });
      if (variables.groupId) queryClient.invalidateQueries({ queryKey: ["drive", "group", variables.groupId] });
      toast({ title: t("common.success") });
      setDialogState(prev => ({ ...prev, open: false }));
    },
    onError: (error) => toast({ title: t("common.error"), description: error instanceof Error ? error.message : t("common.genericError"), variant: "destructive" })
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      return await quozen.groups.deleteGroup(groupId);
    },
    onSuccess: (_, groupId) => {
      queryClient.invalidateQueries({ queryKey: ["drive", "settings"] });
      toast({ title: t("common.success") });
      setAlertState({ open: false, type: "delete" });
      if (groupId === activeGroupId) setActiveGroupId("");
    },
    onError: () => toast({ title: t("common.error"), description: t("groups.deleteError"), variant: "destructive" })
  });

  const leaveGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      return await quozen.groups.leaveGroup(groupId);
    },
    onSuccess: (_, groupId) => {
      queryClient.invalidateQueries({ queryKey: ["drive", "settings"] });
      toast({ title: t("common.success") });
      setAlertState({ open: false, type: "leave" });
      if (groupId === activeGroupId) setActiveGroupId("");
    },
    onError: (error) => toast({ title: t("common.error"), description: error instanceof Error ? error.message : t("common.genericError"), variant: "destructive" })
  });

  return (
    <div className="mx-4 mt-4 pb-20">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">{t("groups.title")}</h2>
        <Button onClick={openCreateDialog} data-testid="button-new-group">
          <Plus className="w-4 h-4 mr-2" />{t("groups.new")}
        </Button>
      </div>

      {pickerError && <Alert variant="destructive" className="mb-4"><AlertCircle className="h-4 w-4" /><AlertDescription>{pickerError}</AlertDescription></Alert>}

      <GroupDialog
        open={dialogState.open}
        onOpenChange={(open) => setDialogState(prev => ({ ...prev, open }))}
        mode={dialogState.mode}
        initialName={dialogState.initialName}
        initialMembers={dialogState.initialMembers}
        isPending={createGroupMutation.isPending || updateGroupMutation.isPending}
        onSubmit={(data) => dialogState.mode === 'create' ? createGroupMutation.mutate(data) : updateGroupMutation.mutate({ groupId: dialogState.groupId!, ...data })}
      />

      <ShareDialog
        isOpen={shareDialog.open}
        onClose={() => setShareDialog(prev => ({ ...prev, open: false }))}
        groupId={shareDialog.groupId}
        groupName={shareDialog.groupName}
      />

      <div className="space-y-4">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center border-2 border-dashed border-muted rounded-xl bg-muted/10">
            <div className="w-20 h-20 bg-background rounded-full flex items-center justify-center mb-4 shadow-sm">
              <FolderSearch className="w-10 h-10 text-muted-foreground/50" />
            </div>
            <h3 className="text-lg font-semibold mb-2">{t("groups.empty.title")}</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-[280px]">
              {t("groups.empty.magicLinkHint")}
            </p>
            <div className="w-full max-w-xs space-y-3">
              <Button onClick={openCreateDialog} className="w-full h-12 shadow-md" data-testid="button-empty-create-group">
                <Plus className="w-4 h-4 mr-2" />
                {t("groups.empty.create")}
              </Button>
              <Button variant="ghost" onClick={() => openPicker()} className="w-full h-12 text-muted-foreground hover:text-primary hover:bg-primary/5">
                {t("groups.empty.recoverHint")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {groups.map((group) => {
              const isActive = group.id === activeGroupId;
              return (
                <Card
                  key={group.id}
                  data-testid="group-card"
                  className={cn(
                    "cursor-pointer transition-all hover:bg-accent/50",
                    isActive ? "ring-2 ring-primary border-primary" : ""
                  )}
                  onClick={() => {
                    if (!isActive) {
                      setActiveGroupId(group.id);
                      toast({ title: t("groups.switched") });
                    }
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3 overflow-hidden">
                        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center shrink-0 border border-primary/20">
                          <Users className="w-6 h-6 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-foreground truncate text-base">{group.name}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={group.isOwner ? "secondary" : "outline"} className="text-[10px] px-1.5 py-0 h-5 font-normal">
                              {group.isOwner ? <Shield className="w-3 h-3 mr-1" /> : <User className="w-3 h-3 mr-1" />}
                              {group.isOwner ? t("roles.owner") : t("roles.member")}
                            </Badge>
                            {isActive && (
                              <Badge variant="default" className="text-[10px] px-1.5 py-0 h-5 bg-primary text-primary-foreground border-transparent">
                                {t("groups.current")}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={(e) => e.stopPropagation()}
                              data-testid="group-menu-trigger"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {group.isOwner ? (
                              <>
                                <DropdownMenuItem onClick={(e) => handleShareClick(e, group)}>
                                  <Share2 className="w-4 h-4 mr-2" /> {t("common.share")}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => handleEditClick(e, group)} data-testid="menuitem-edit">
                                  <Pencil className="w-4 h-4 mr-2" /> {t("common.edit")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={(e) => handleDeleteClick(e, group)} data-testid="menuitem-delete"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" /> {t("common.delete")}
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={(e) => handleLeaveClick(e, group)}
                              >
                                <LogOut className="w-4 h-4 mr-2" /> {t("groups.leaveAction")}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Recovery Footer */}
            <div className="mt-8 text-center border-t pt-6">
              <p className="text-xs text-muted-foreground mb-3">{t("groups.recover")}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openPicker()}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                {t("groups.findInDrive")}
              </Button>
            </div>
          </>
        )}
      </div>

      <AlertDialog open={alertState.open} onOpenChange={(open) => !open && setAlertState(prev => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{alertState.type === 'delete' ? t("groups.delete") : t("groups.leave")}</AlertDialogTitle>
            <AlertDialogDescription>
              {alertState.type === 'delete'
                ? t("groups.confirmDelete", { name: alertState.group?.name })
                : t("groups.confirmLeave", { name: alertState.group?.name })}
              {alertState.type === 'delete' && <br />}
              {alertState.type === 'delete' && t("groups.confirmDeleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="alert-action-confirm" onClick={() => {
              if (!alertState.group) return;
              alertState.type === 'delete' ? deleteGroupMutation.mutate(alertState.group.id) : leaveGroupMutation.mutate(alertState.group.id);
            }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{alertState.type === 'delete' ? t("groups.deleteAction") : t("groups.leaveAction")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
