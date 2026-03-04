import { useSettings } from "./use-settings";
import { Group } from "@quozen/core";

export function useGroups() {
    const { settings, isLoading, error } = useSettings();

    // Safely map cached groups, defaulting to empty array if settings not loaded yet
    const groups: Group[] = settings?.groupCache?.map((cg) => ({
        id: cg.id,
        name: cg.name,
        description: "Google Sheet Group",
        createdBy: "Unknown",
        participants: [], // Cache doesn't store participants details for performance
        createdAt: cg.lastAccessed ? new Date(cg.lastAccessed) : new Date(),
        isOwner: cg.role === "owner",
    })) || [];

    return {
        groups,
        isLoading,
        error
    };
}
