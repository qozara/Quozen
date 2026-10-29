import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, RefreshCw, ChevronLeft } from "lucide-react";
import GroupSwitcherModal from "./group-switcher-modal";
import { useState } from "react";
import { quozen } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useGroups } from "@/hooks/use-groups";
import { useTranslation } from "react-i18next";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { Button } from "./ui/button";
import { useAppContext } from "@/context/app-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SyncTrigger } from "./sync/SyncTrigger";
import { GroupIcon, getGroupPresetBackground, GROUP_ICON_PRESETS } from "./group-icon";

export default function Header() {
  const { activeGroupId, currentUserId } = useAppContext();
  const [showGroupSwitcher, setShowGroupSwitcher] = useState(false);
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { isEnabled } = useAutoSync();
  const location = useLocation();
  const navigate = useNavigate();

  const isSubPage = location.pathname.startsWith("/edit-expense") ||
    location.pathname.startsWith("/profile");

  const getTitle = () => {
    if (location.pathname.startsWith("/edit-expense")) return t("expenseForm.editTitle");
    if (location.pathname.startsWith("/profile")) return t("profile.title") || "Profile";
    return null;
  };

  // 1. Fetch group list via hook
  const { groups, isLoading: isGroupsLoading } = useGroups();

  // 2. Fetch active group data (content)
  const { data: ledger, isFetching: isDataFetching } = useQuery({
    queryKey: ["drive", "group", activeGroupId],
    queryFn: () => quozen.ledger(activeGroupId, currentUserId).getLedger(),
    enabled: !!activeGroupId,
  });

  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const activeIcon = activeGroup?.icon || ledger?.icon;
  const memberCount = ledger?.members?.length || 0;
  const activePreset = activeIcon?.startsWith("preset:")
    ? GROUP_ICON_PRESETS.find((p) => p.id === activeIcon)
    : null;
  const bgStyle = getGroupPresetBackground(activeIcon);
  const hasCustomBanner = !isSubPage && Boolean(bgStyle);

  const isSyncing = isGroupsLoading || isDataFetching;

  const handleRefresh = async () => {
    if (!activeGroupId) return;

    // US-106: Only invalidate the active group data
    await queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
  };

  return (
    <>
      <header
        className={cn(
          "relative border-b border-border sticky top-0 z-40 transition-all",
          hasCustomBanner ? "backdrop-blur-md px-4 py-4" : "bg-card px-4 py-3"
        )}
        style={{
          backgroundColor: hasCustomBanner
            ? "color-mix(in srgb, var(--card) 80%, transparent)"
            : undefined
        }}
        data-testid="header"
      >
        {/* Taller Hero Blurred Banner */}
        {hasCustomBanner && (
          <div
            data-testid="hero-blurred-banner"
            aria-hidden="true"
            className="absolute inset-0 -z-10 pointer-events-none overflow-hidden"
          >
            {activePreset ? (
              <div className="absolute inset-0 overflow-hidden">
                <div
                  className="absolute -inset-4 blur-2xl opacity-60 dark:opacity-45 transform scale-125"
                  style={{ background: activePreset.cssGradient }}
                />
                <div
                  data-testid="hero-blurred-preset-icon"
                  className="absolute right-6 -top-6 opacity-35 dark:opacity-25 blur-[1.5px] pointer-events-none transform rotate-12"
                >
                  <activePreset.icon className="w-32 h-32 text-foreground" />
                </div>
              </div>
            ) : (
              <div
                className="absolute -inset-4 bg-cover bg-center blur-2xl opacity-40 dark:opacity-30 transform scale-125"
                style={{
                  background: bgStyle?.startsWith("url") ? undefined : bgStyle || undefined,
                  backgroundImage: bgStyle?.startsWith("url") ? bgStyle : undefined
                }}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-b from-card/30 via-card/60 to-card/90" />
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3 min-w-0">
            {isSubPage ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-ml-2"
                  onClick={() => navigate(-1)}
                  data-testid="button-back"
                >
                  <ChevronLeft className="w-6 h-6" />
                </Button>
                <h1 className="text-lg font-semibold text-foreground">
                  {getTitle()}
                </h1>
              </>
            ) : (
              <>
                <GroupIcon
                  icon={activeIcon}
                  name={activeGroup?.name}
                  className="w-10 h-10 shadow-sm"
                  iconClassName="w-5 h-5"
                />
                <div className="min-w-0">
                  <button
                    onClick={() => setShowGroupSwitcher(true)}
                    className="text-left block max-w-full"
                    data-testid="button-switch-group"
                  >
                    <div className="flex items-center gap-1.5">
                      <h1 className="text-lg font-semibold text-foreground truncate max-w-[200px]">
                        {activeGroup?.name || t("header.selectGroup")}
                      </h1>
                      {activeGroup && (
                        <span
                          data-testid="active-group-badge"
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary shrink-0"
                        >
                          {t("header.activeGroup", "Active")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center text-sm text-muted-foreground">
                      <span data-testid="text-participant-count">
                        {t("header.people", { count: memberCount })}
                      </span>
                      <ChevronDown className="ml-1 w-3 h-3" />
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <div id="header-actions-slot" className="flex items-center space-x-2" />
            <SyncTrigger />
            {!isSubPage && !isEnabled && (
              <button
                className="w-8 h-8 rounded-full bg-muted flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-50"
                onClick={handleRefresh}
                disabled={isSyncing}
                title="Sync current group"
                data-testid="button-refresh"
              >
                <RefreshCw className={cn(
                  "w-4 h-4 text-muted-foreground",
                  isSyncing && "animate-spin text-primary"
                )} />
              </button>
            )}

            {/* TODO: Re-enable notifications bell when feature is fully defined
            {!isSubPage && (
              <button className="w-8 h-8 rounded-full bg-muted flex items-center justify-center" data-testid="button-notifications">
                <Bell className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            */}
          </div>
        </div>
      </header>

      <GroupSwitcherModal
        isOpen={showGroupSwitcher}
        onClose={() => setShowGroupSwitcher(false)}
      />
    </>
  );
}
