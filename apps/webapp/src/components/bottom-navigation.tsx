import { useLocation, useNavigate } from "react-router-dom";
import { Home, Plus, Users, User, Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppContext } from "@/context/app-context";
import { useSettings } from "@/hooks/use-settings";

export default function BottomNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { activeGroupId, setIsAddExpenseOpen } = useAppContext();
  const { settings } = useSettings();

  const isArchived = Boolean(activeGroupId && settings?.archivedGroupCache?.some(g => g.id === activeGroupId));

  const hiddenRoutes = ["/add-expense", "/edit-expense"];
  const shouldHide = hiddenRoutes.some(route => location.pathname.startsWith(route));

  if (shouldHide) {
    return null;
  }

  const tabs = [
    { id: "home", path: "/dashboard", icon: Home, label: t("nav.home") },
    { id: "expenses", path: "/expenses", icon: Activity, label: t("nav.activity") },
    { id: "add", path: "/add-expense", icon: Plus, label: "" },
    { id: "groups", path: "/groups", icon: Users, label: t("nav.groups") },
    { id: "profile", path: "/profile", icon: User, label: t("nav.profile") },
  ];

  return (
    <nav className="fixed bottom-0 left-1/2 transform -translate-x-1/2 w-full max-w-md bg-card border-t border-border z-50" data-testid="bottom-navigation">
      <div className="flex items-center justify-around py-2">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          const isAddButton = tab.id === "add";
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              onClick={() => {
                if (isAddButton) {
                  if (isArchived) return;
                  setIsAddExpenseOpen(true);
                } else {
                  navigate(tab.path);
                }
              }}
              disabled={isAddButton && isArchived}
              className={`flex flex-col items-center py-2 px-4 ${isAddButton
                ? isArchived
                  ? "bg-muted text-muted-foreground rounded-full -mt-3 shadow opacity-50 cursor-not-allowed"
                  : "bg-primary text-primary-foreground rounded-full -mt-3 shadow-lg"
                : isActive
                  ? "text-primary"
                  : "text-muted-foreground"
                }`}
              data-testid={`button-nav-${tab.id}`}
            >
              <Icon className={`${isAddButton ? "text-xl" : "w-5 h-5"} mb-1`} />
              {tab.label && <span className="text-xs">{tab.label}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
