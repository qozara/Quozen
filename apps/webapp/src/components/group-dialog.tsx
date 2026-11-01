import { useState, useEffect, useRef } from "react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerFooter } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseMembers } from "@/lib/utils";
import { MemberInput, GroupMembershipResolver } from "@quozen/core";
import { useTranslation } from "react-i18next";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { X, Plus, Loader2, Upload, Trash2, Check, Share2, Users, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { GroupIcon, GROUP_ICON_PRESETS } from "./group-icon";
import { compressImage } from "@/lib/image-compression";
import { cn } from "@/lib/utils";
import { useGroupParticipants } from "@/hooks/use-group-participants";

interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  groupId?: string;
  initialName?: string;
  initialMembers?: string;
  initialIcon?: string;
  isPending: boolean;
  onOpenShare?: () => void;
  onSubmit: (data: { name: string; members: MemberInput[]; icon?: string }) => void;
}

export default function GroupDialog({
  open,
  onOpenChange,
  mode,
  groupId,
  initialName = "",
  initialMembers = "",
  initialIcon = "",
  isPending,
  onOpenShare,
  onSubmit
}: GroupDialogProps) {
  const [groupName, setGroupName] = useState(initialName);
  const [members, setMembers] = useState<MemberInput[]>([]);
  const [newMember, setNewMember] = useState("");
  const [icon, setIcon] = useState(initialIcon);
  const [isCompressing, setIsCompressing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { t } = useTranslation();
  const { setPaused } = useAutoSync();

  const { data: participantsData } = useGroupParticipants(
    groupId,
    open && mode === "edit" && Boolean(groupId)
  );

  useEffect(() => {
    if (open) setPaused(true);
    return () => setPaused(false);
  }, [open, setPaused]);

  useEffect(() => {
    if (open) {
      setGroupName(initialName);
      setMembers(parseMembers(initialMembers));
      setNewMember("");
      setIcon(initialIcon);
      setUploadError(null);
    }
  }, [open, initialName, initialMembers, initialIcon]);

  const handleAddMember = () => {
    if (!newMember.trim()) return;
    const parsed = parseMembers(newMember);
    if (parsed.length > 0) {
      setMembers(prev => [...prev, ...parsed]);
      setNewMember("");
    }
  };

  const handleRemoveMember = (index: number) => {
    setMembers(prev => prev.filter((_, i) => i !== index));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsCompressing(true);
      setUploadError(null);
      const compressedDataUrl = await compressImage(file, 400);
      setIcon(compressedDataUrl);
    } catch (err: any) {
      setUploadError(err.message || t("groups.uploadError"));
    } finally {
      setIsCompressing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    let finalMembers = [...members];
    if (newMember.trim()) {
      finalMembers = [...finalMembers, ...parseMembers(newMember)];
    }

    onSubmit({
      name: groupName.trim(),
      members: finalMembers,
      icon
    });
  };

  const showRichUnifiedList = mode === "edit" && participantsData && participantsData.accounts.length > 0;

  return (
    <Drawer
      open={open}
      onOpenChange={(newOpen) => {
        if (isPending) return;
        onOpenChange(newOpen);
      }}
      dismissible={!isPending}
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle data-testid="drawer-title-group">
            {mode === 'create' ? t("groups.create") : t("groups.edit")}
          </DrawerTitle>
          <DrawerDescription>
            {mode === 'create' ? t("groups.new") : t("groups.update")}
          </DrawerDescription>
        </DrawerHeader>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <form id="group-form" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="groupName">{t("groups.nameLabel")} *</Label>
              <Input
                id="groupName"
                placeholder={t("groups.namePlaceholder") || "e.g., Weekend Trip"}
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                required
                data-testid="input-group-name"
              />
            </div>

            {/* Group Icon & Banner Section */}
            <div className="space-y-2 border border-border/70 rounded-xl p-3.5 bg-muted/30 shadow-xs">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">{t("groups.iconLabel")}</Label>
                {icon && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIcon("")}
                    data-testid="button-clear-icon"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 px-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t("groups.removeIcon")}</span>
                  </Button>
                )}
              </div>

              {/* Current Preview */}
              <div className="flex items-center gap-3 py-1">
                <GroupIcon icon={icon} name={groupName} className="w-12 h-12" iconClassName="w-6 h-6" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {t("groups.selectPreset")}
                  </p>
                  {uploadError && (
                    <p className="text-xs text-destructive mt-1">{uploadError}</p>
                  )}
                </div>
              </div>

              {/* Preset Icon Grid */}
              <div className="flex flex-wrap gap-2 pt-1">
                {GROUP_ICON_PRESETS.map((preset) => {
                  const isSelected = icon === preset.id;
                  const IconComp = preset.icon;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setIcon(preset.id)}
                      data-testid={`preset-icon-${preset.id}`}
                      className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center text-white transition-all transform hover:scale-105 shadow-sm relative",
                        `bg-gradient-to-br ${preset.gradient}`,
                        isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-110" : "opacity-85 hover:opacity-100"
                      )}
                      aria-label={t(preset.labelKey)}
                    >
                      <IconComp className="w-4 h-4" />
                      {isSelected && (
                        <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full p-0.5 shadow">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Custom Photo Upload */}
              <div className="pt-2">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileUpload}
                  data-testid="input-upload-photo"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isCompressing}
                  className="w-full text-xs h-9 flex items-center justify-center gap-1.5"
                >
                  {isCompressing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t("common.loading")}</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      <span>{t("groups.uploadPhoto")}</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Members & Accounts Section */}
            <div>
              <Label htmlFor="newMember">
                {mode === "edit" ? t("groups.membersSectionTitle") : t("groups.membersLabel")}
              </Label>
              <div className="flex gap-2 mt-1">
                <Input
                  id="newMember"
                  placeholder={t("groups.membersHint")}
                  value={newMember}
                  onChange={(e) => setNewMember(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddMember();
                    }
                  }}
                  data-testid="input-group-members"
                />
                <Button type="button" onClick={handleAddMember} size="icon" variant="outline">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {/* Mode Edit: Unified Accounts & Members List */}
              {showRichUnifiedList ? (
                <div className="space-y-2 mt-3" data-testid="unified-participants-list">
                  {participantsData.accounts.map((account) => {
                    const isOwner = account.member.role === "owner";
                    let subtitle = "";
                    if (account.kind === "shared") {
                      subtitle = GroupMembershipResolver.formatManagers(account.managers);
                    } else if (account.kind === "personal") {
                      subtitle = account.managers[0]?.email || account.member.email;
                    } else {
                      subtitle = t("groups.offlineAccount");
                    }

                    // Matching index in editable members state
                    const memberIdx = members.findIndex(m =>
                      (m.email && account.member.email && m.email.toLowerCase() === account.member.email.toLowerCase()) ||
                      (m.username && (m.username === account.member.name || m.username === account.member.userId))
                    );

                    return (
                      <div
                        key={account.member.userId}
                        className="flex items-center justify-between p-2 rounded-lg border bg-card/60 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar className="w-7 h-7">
                            {account.managers[0]?.avatarUrl && (
                              <AvatarImage src={account.managers[0].avatarUrl} alt={account.member.name} />
                            )}
                            <AvatarFallback className="text-[10px] uppercase font-medium bg-muted">
                              {account.member.name.slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium truncate max-w-[150px]">
                              {account.member.name}
                            </span>
                            {subtitle && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                                {subtitle}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {account.kind === "shared" && (
                            <Badge variant="secondary" className="text-[9px] h-4 bg-primary/10 text-primary px-1.5">
                              {t("groups.sharedAccount")}
                            </Badge>
                          )}
                          {account.kind === "offline" && (
                            <Badge variant="outline" className="text-[9px] h-4 text-muted-foreground px-1.5">
                              {t("groups.offlineAccount")}
                            </Badge>
                          )}
                          {isOwner && (
                            <Badge variant="default" className="text-[9px] h-4 px-1.5">
                              {t("roles.owner")}
                            </Badge>
                          )}
                          {!isOwner && memberIdx >= 0 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(memberIdx)}
                              className="hover:bg-muted text-muted-foreground hover:text-destructive rounded-full p-1 transition-colors"
                              title={t("common.delete")}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Unassigned Collaborators Notice */}
                  {participantsData.unassignedCollaborators.length > 0 && (
                    <div className="p-2.5 rounded-lg border border-amber-200/80 bg-amber-50/50 dark:bg-amber-950/20 text-xs space-y-1 mt-2">
                      <div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300 text-[11px]">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{t("groups.unassignedCollaboratorsTitle")}</span>
                      </div>
                      <div className="space-y-1">
                        {participantsData.unassignedCollaborators.map(c => (
                          <div key={c.id || c.email} className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>{c.displayName} ({c.email})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Newly added pending members */}
                  {members.filter(m => {
                    const norm = (m.email || m.username || "").toLowerCase();
                    return !participantsData.accounts.some(a =>
                      (a.member.email && a.member.email.toLowerCase() === norm) ||
                      a.member.name.toLowerCase() === norm ||
                      a.member.userId.toLowerCase() === norm
                    );
                  }).map((m, i) => (
                    <Badge key={i} variant="secondary" className="pl-2 pr-1 py-1 flex items-center gap-1">
                      <span className="truncate max-w-[150px]">{m.email || m.username}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const idx = members.indexOf(m);
                          if (idx >= 0) handleRemoveMember(idx);
                        }}
                        className="hover:bg-muted rounded-full p-0.5 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                members.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {members.map((m, i) => (
                      <Badge key={i} variant="secondary" className="pl-2 pr-1 py-1 flex items-center gap-1">
                        <span className="truncate max-w-[150px]">{m.email || m.username}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(i)}
                          className="hover:bg-muted rounded-full p-0.5 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )
              )}

              <p className="text-xs text-muted-foreground mt-2">
                {t("groups.membersHint2")}
              </p>

              {/* Link to Share Dialog */}
              {mode === "edit" && onOpenShare && participantsData && (
                <div className="pt-2">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="p-0 h-auto text-xs text-primary flex items-center gap-1.5"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenShare();
                    }}
                    data-testid="link-manage-sharing"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>{t("groups.manageAccessLink", { count: participantsData.collaborators.length })}</span>
                  </Button>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Sticky Footer */}
        <DrawerFooter className="border-t bg-background">
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              className="flex-1 h-12"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              form="group-form"
              className="flex-1 h-12"
              disabled={isPending}
              data-testid="button-submit-group"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t("expenseForm.saving")}
                </>
              ) : (
                mode === 'create' ? t("groups.create") : t("groups.update")
              )}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
