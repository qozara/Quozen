import { useState, useEffect } from "react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerFooter } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseMembers } from "@/lib/utils";
import { MemberInput } from "@quozen/core";
import { useTranslation } from "react-i18next";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { X, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initialName?: string;
  initialMembers?: string;
  isPending: boolean;
  onSubmit: (data: { name: string, members: MemberInput[] }) => void;
}

export default function GroupDialog({
  open,
  onOpenChange,
  mode,
  initialName = "",
  initialMembers = "",
  isPending,
  onSubmit
}: GroupDialogProps) {
  const [groupName, setGroupName] = useState(initialName);
  const [members, setMembers] = useState<MemberInput[]>([]);
  const [newMember, setNewMember] = useState("");
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
    }
  }, [open, initialName, initialMembers]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    let finalMembers = [...members];
    if (newMember.trim()) {
      finalMembers = [...finalMembers, ...parseMembers(newMember)];
    }

    onSubmit({
      name: groupName.trim(),
      members: finalMembers
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle data-testid="drawer-title-group">{mode === 'create' ? t("groups.create") : t("groups.edit")}</DrawerTitle>
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
                placeholder="e.g., Weekend Trip"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                required
                data-testid="input-group-name"
              />
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
              {isPending ? t("expenseForm.saving") : (mode === 'create' ? t("groups.create") : t("groups.update"))}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
