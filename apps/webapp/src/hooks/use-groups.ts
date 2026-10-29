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
        ...(cg.icon !== undefined ? { icon: cg.icon } : {})
    })) || [];

    const archivedGroups: Group[] = settings?.archivedGroupCache?.map((cg) => ({
        id: cg.id,
        name: cg.name,
        description: "Archived Group",
        createdBy: "Unknown",
        participants: [],
        createdAt: cg.lastAccessed ? new Date(cg.lastAccessed) : new Date(),
        isOwner: cg.role === "owner",
        ...(cg.icon !== undefined ? { icon: cg.icon } : {})
    })) || [];

    return {
        groups,
        archivedGroups,
        isLoading,
        error
    };
}
