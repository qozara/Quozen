import { useState, useEffect, useRef } from "react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerFooter } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseMembers } from "@/lib/utils";
import { MemberInput } from "@quozen/core";
import { useTranslation } from "react-i18next";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { X, Plus, Loader2, Upload, Trash2, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GroupIcon, GROUP_ICON_PRESETS } from "./group-icon";
import { compressImage } from "@/lib/image-compression";
import { cn } from "@/lib/utils";

interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initialName?: string;
  initialMembers?: string;
  initialIcon?: string;
  isPending: boolean;
  onSubmit: (data: { name: string; members: MemberInput[]; icon?: string }) => void;
}

export default function GroupDialog({
  open,
  onOpenChange,
  mode,
  initialName = "",
  initialMembers = "",
  initialIcon = "",
  isPending,
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

            <div>
              <Label htmlFor="newMember">{t("groups.membersLabel")}</Label>
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

              {members.length > 0 && (
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
              )}

              <p className="text-xs text-muted-foreground mt-2">
                {t("groups.membersHint2")}
              </p>
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
