import {
    Users,
    Home,
    Plane,
    Utensils,
    ShoppingBag,
    PartyPopper,
    Car,
    Briefcase,
    Heart,
    LucideIcon
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface GroupIconPreset {
    id: string;
    labelKey: string;
    icon: LucideIcon;
    gradient: string;
    cssGradient: string;
}

export const GROUP_ICON_PRESETS: GroupIconPreset[] = [
    {
        id: "preset:home",
        labelKey: "groups.presets.home",
        icon: Home,
        gradient: "from-blue-500 to-indigo-600",
        cssGradient: "linear-gradient(135deg, #3b82f6, #4f46e5)"
    },
    {
        id: "preset:plane",
        labelKey: "groups.presets.plane",
        icon: Plane,
        gradient: "from-sky-400 to-emerald-500",
        cssGradient: "linear-gradient(135deg, #38bdf8, #10b981)"
    },
    {
        id: "preset:utensils",
        labelKey: "groups.presets.food",
        icon: Utensils,
        gradient: "from-amber-500 to-orange-600",
        cssGradient: "linear-gradient(135deg, #f59e0b, #ea580c)"
    },
    {
        id: "preset:shopping",
        labelKey: "groups.presets.shopping",
        icon: ShoppingBag,
        gradient: "from-pink-500 to-rose-600",
        cssGradient: "linear-gradient(135deg, #ec4899, #e11d48)"
    },
    {
        id: "preset:party",
        labelKey: "groups.presets.party",
        icon: PartyPopper,
        gradient: "from-purple-500 to-pink-500",
        cssGradient: "linear-gradient(135deg, #a855f7, #ec4899)"
    },
    {
        id: "preset:car",
        labelKey: "groups.presets.car",
        icon: Car,
        gradient: "from-teal-500 to-cyan-600",
        cssGradient: "linear-gradient(135deg, #14b8a6, #0891b2)"
    },
    {
        id: "preset:briefcase",
        labelKey: "groups.presets.work",
        icon: Briefcase,
        gradient: "from-slate-600 to-zinc-800",
        cssGradient: "linear-gradient(135deg, #475569, #27272a)"
    },
    {
        id: "preset:heart",
        labelKey: "groups.presets.heart",
        icon: Heart,
        gradient: "from-red-500 to-pink-600",
        cssGradient: "linear-gradient(135deg, #ef4444, #db2777)"
    }
];

export function getGroupPresetBackground(icon?: string): string | null {
    if (!icon) return null;
    if (icon.startsWith("preset:")) {
        const preset = GROUP_ICON_PRESETS.find(p => p.id === icon);
        return preset ? preset.cssGradient : null;
    }
    return `url(${icon})`;
}

interface GroupIconProps {
    icon?: string;
    name?: string;
    className?: string;
    iconClassName?: string;
}

export function GroupIcon({ icon, name, className, iconClassName }: GroupIconProps) {
    if (icon?.startsWith("preset:")) {
        const preset = GROUP_ICON_PRESETS.find(p => p.id === icon);
        if (preset) {
            const IconComp = preset.icon;
            return (
                <div
                    className={cn(
                        "rounded-full flex items-center justify-center text-white shrink-0 bg-gradient-to-br shadow-sm",
                        preset.gradient,
                        className || "w-8 h-8"
                    )}
                >
                    <IconComp className={cn("w-4 h-4", iconClassName)} />
                </div>
            );
        }
    }

    if (icon) {
        return (
            <div
                className={cn(
                    "rounded-full overflow-hidden shrink-0 bg-muted flex items-center justify-center border border-border/40 shadow-sm",
                    className || "w-8 h-8"
                )}
            >
                <img
                    src={icon}
                    alt={name || "Group icon"}
                    className="w-full h-full object-cover"
                    loading="lazy"
                />
            </div>
        );
    }

    return (
        <div
            className={cn(
                "rounded-full flex items-center justify-center shrink-0 bg-primary text-primary-foreground shadow-sm",
                className || "w-8 h-8"
            )}
        >
            <Users className={cn("w-4 h-4", iconClassName)} />
        </div>
    );
}
