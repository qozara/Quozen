import type { CachedGroup } from "../domain/models";

function parseTimestamp(val?: string | number | null): number {
    if (!val) return 0;
    if (typeof val === "number") return val;
    const t = new Date(val).getTime();
    return isNaN(t) ? 0 : t;
}

function getGroupEntryTime(entry?: CachedGroup | null): number {
    if (!entry) return 0;
    return Math.max(parseTimestamp(entry.updatedAt), parseTimestamp(entry.lastAccessed));
}

export interface MergeUserSettingsOptions {
    syncedGroupIds?: Set<string>;
    lastSyncedAt?: string;
    isGroupHydrated?: (groupId: string) => boolean;
}

export interface MergeUserSettingsResult {
    mergedDoc: Record<string, any>;
    shouldUpdateLocal: boolean;
    shouldPushRemote: boolean;
}

export function mergeUserSettingsDocs(
    localDoc: Record<string, any> = {},
    remoteDoc: Record<string, any> = {},
    options?: MergeUserSettingsOptions
): MergeUserSettingsResult {
    let shouldUpdateLocal = false;
    let shouldPushRemote = false;

    // 1. Preferences & API Key
    const localPrefTime = parseTimestamp(localDoc.preferencesUpdatedAt || localDoc.updatedAt || localDoc.lastUpdated);
    const remotePrefTime = parseTimestamp(remoteDoc.preferencesUpdatedAt || remoteDoc.updatedAt || remoteDoc.lastUpdated);

    let preferences = { ...(localDoc.preferences || remoteDoc.preferences || { defaultCurrency: "USD", theme: "system" }) };
    let encryptedApiKey = localDoc.encryptedApiKey ?? remoteDoc.encryptedApiKey;
    let preferencesUpdatedAt = localDoc.preferencesUpdatedAt || remoteDoc.preferencesUpdatedAt;

    if (remotePrefTime > localPrefTime) {
        if (remoteDoc.preferences) {
            preferences = { ...remoteDoc.preferences };
        }
        encryptedApiKey = remoteDoc.encryptedApiKey;
        preferencesUpdatedAt = remoteDoc.preferencesUpdatedAt || remoteDoc.updatedAt || remoteDoc.lastUpdated;

        const prefsChanged = JSON.stringify(preferences) !== JSON.stringify(localDoc.preferences || {});
        const keyChanged = encryptedApiKey !== localDoc.encryptedApiKey;
        if (prefsChanged || keyChanged) {
            shouldUpdateLocal = true;
        }
    } else if (localPrefTime > remotePrefTime) {
        if (localDoc.preferences) {
            preferences = { ...localDoc.preferences };
        }
        encryptedApiKey = localDoc.encryptedApiKey;
        preferencesUpdatedAt = localDoc.preferencesUpdatedAt || localDoc.updatedAt || localDoc.lastUpdated;

        const prefsChanged = JSON.stringify(preferences) !== JSON.stringify(remoteDoc.preferences || {});
        const keyChanged = encryptedApiKey !== remoteDoc.encryptedApiKey;
        if (prefsChanged || keyChanged) {
            shouldPushRemote = true;
        }
    } else {
        // Equal timestamps
        if (!localDoc.preferences && remoteDoc.preferences) {
            preferences = { ...remoteDoc.preferences };
            shouldUpdateLocal = true;
        } else if (localDoc.preferences) {
            preferences = { ...localDoc.preferences };
        }

        if (localDoc.encryptedApiKey === undefined && remoteDoc.encryptedApiKey !== undefined) {
            encryptedApiKey = remoteDoc.encryptedApiKey;
            shouldUpdateLocal = true;
        } else {
            encryptedApiKey = localDoc.encryptedApiKey ?? remoteDoc.encryptedApiKey;
        }

        preferencesUpdatedAt = localDoc.preferencesUpdatedAt || remoteDoc.preferencesUpdatedAt;
    }

    // 2. Group Cache (groupCache[])
    const localGroups: CachedGroup[] = Array.isArray(localDoc.groupCache) ? localDoc.groupCache : [];
    const remoteGroups: CachedGroup[] = Array.isArray(remoteDoc.groupCache) ? remoteDoc.groupCache : [];

    const localGroupsMap = new Map<string, CachedGroup>();
    for (const g of localGroups) {
        if (g && g.id) localGroupsMap.set(g.id, { ...g });
    }

    const remoteGroupsMap = new Map<string, CachedGroup>();
    for (const g of remoteGroups) {
        if (g && g.id) remoteGroupsMap.set(g.id, { ...g });
    }

    // Archived Group Cache (archivedGroupCache[])
    const localArchived: CachedGroup[] = Array.isArray(localDoc.archivedGroupCache) ? localDoc.archivedGroupCache : [];
    const remoteArchived: CachedGroup[] = Array.isArray(remoteDoc.archivedGroupCache) ? remoteDoc.archivedGroupCache : [];

    const localArchivedMap = new Map<string, CachedGroup>();
    for (const g of localArchived) {
        if (g && g.id) localArchivedMap.set(g.id, { ...g });
    }

    const remoteArchivedMap = new Map<string, CachedGroup>();
    for (const g of remoteArchived) {
        if (g && g.id) remoteArchivedMap.set(g.id, { ...g });
    }

    const syncedGroupIds = options?.syncedGroupIds;
    const lastSyncedAtTime = parseTimestamp(options?.lastSyncedAt);
    const mergedGroupsMap = new Map<string, CachedGroup>();

    // Helper to merge two CachedGroup entries for the same group ID
    const mergeTwoGroupEntries = (
        localEntry: CachedGroup,
        remoteEntry: CachedGroup,
        isArchivedContext = false
    ): { winner: CachedGroup; updateLocal: boolean; pushRemote: boolean } => {
        const localTime = getGroupEntryTime(localEntry);
        const remoteTime = getGroupEntryTime(remoteEntry);

        const lAcc = parseTimestamp(localEntry.lastAccessed);
        const rAcc = parseTimestamp(remoteEntry.lastAccessed);
        const maxLastAccessed = lAcc >= rAcc ? localEntry.lastAccessed : remoteEntry.lastAccessed;

        const winnerIcon = remoteTime > localTime
            ? (remoteEntry.icon ?? localEntry.icon)
            : (localEntry.icon ?? remoteEntry.icon);

        let winner: CachedGroup;
        let updateLocal = false;
        let pushRemote = false;

        if (remoteTime > localTime) {
            winner = {
                ...remoteEntry,
                lastAccessed: maxLastAccessed,
                updatedAt: remoteEntry.updatedAt || remoteEntry.lastAccessed,
                ...(winnerIcon !== undefined ? { icon: winnerIcon } : {})
            };
            updateLocal = true;
        } else if (localTime > remoteTime) {
            winner = {
                ...localEntry,
                lastAccessed: maxLastAccessed,
                updatedAt: localEntry.updatedAt || localEntry.lastAccessed,
                ...(winnerIcon !== undefined ? { icon: winnerIcon } : {})
            };
            pushRemote = true;
        } else {
            // Tie breaker: take defined fields
            winner = {
                ...remoteEntry,
                ...localEntry,
                lastAccessed: maxLastAccessed,
                ...(winnerIcon !== undefined ? { icon: winnerIcon } : {})
            };
            if (!isArchivedContext && localEntry.pendingRename && !remoteEntry.pendingRename) {
                pushRemote = true;
            }
        }

        if (!isArchivedContext) {
            // If local has pendingRename === true and localTime >= remoteTime, keep pendingRename: true
            if (localEntry.pendingRename === true && localTime >= remoteTime) {
                winner.pendingRename = true;
                if (!remoteEntry.pendingRename) {
                    pushRemote = true;
                }
            }
        }

        return { winner, updateLocal, pushRemote };
    };

    // Case A: Groups present in both groupCache
    for (const [id, localEntry] of localGroupsMap.entries()) {
        const remoteEntry = remoteGroupsMap.get(id);
        if (remoteEntry) {
            const { winner, updateLocal, pushRemote } = mergeTwoGroupEntries(localEntry, remoteEntry, false);
            if (updateLocal) shouldUpdateLocal = true;
            if (pushRemote) shouldPushRemote = true;
            mergedGroupsMap.set(id, winner);
        }
    }

    // Case B: Groups only in remote groupCache
    for (const [id, remoteEntry] of remoteGroupsMap.entries()) {
        if (!localGroupsMap.has(id)) {
            // Check if local has it in archivedGroupCache
            const localArchivedEntry = localArchivedMap.get(id);
            if (localArchivedEntry) {
                const localTime = getGroupEntryTime(localArchivedEntry);
                const remoteTime = getGroupEntryTime(remoteEntry);
                if (remoteTime > localTime) {
                    // Remote unarchived or updated group more recently
                    mergedGroupsMap.set(id, { ...remoteEntry, ...(remoteEntry.icon ?? localArchivedEntry.icon ? { icon: remoteEntry.icon ?? localArchivedEntry.icon } : {}) });
                    shouldUpdateLocal = true;
                }
                // If localTime >= remoteTime, it stays in archived (handled in archived merge)
            } else if (syncedGroupIds && syncedGroupIds.has(id)) {
                // Local device previously had it and deleted it!
                shouldPushRemote = true;
            } else {
                // Newly discovered group from remote
                mergedGroupsMap.set(id, { ...remoteEntry });
                shouldUpdateLocal = true;
            }
        }
    }

    // Case C: Groups only in local groupCache
    for (const [id, localEntry] of localGroupsMap.entries()) {
        if (!remoteGroupsMap.has(id)) {
            // Check if remote has it in archivedGroupCache
            const remoteArchivedEntry = remoteArchivedMap.get(id);
            if (remoteArchivedEntry) {
                const localTime = getGroupEntryTime(localEntry);
                const remoteTime = getGroupEntryTime(remoteArchivedEntry);
                if (localTime >= remoteTime) {
                    // Local unarchived or updated group more recently (or tied)
                    mergedGroupsMap.set(id, { ...localEntry, ...(localEntry.icon ?? remoteArchivedEntry.icon ? { icon: localEntry.icon ?? remoteArchivedEntry.icon } : {}) });
                    shouldPushRemote = true;
                }
                // If remoteTime > localTime, it stays in archived (handled in archived merge)
            } else {
                const localTime = getGroupEntryTime(localEntry);
                const inSynced = syncedGroupIds ? syncedGroupIds.has(id) : false;
                // Remote deleted it if it was previously synced and local has not modified it since last sync
                if (
                    inSynced &&
                    (lastSyncedAtTime === 0 || localTime <= lastSyncedAtTime)
                ) {
                    // Remote device deleted it
                    shouldUpdateLocal = true;
                } else {
                    // Created or updated locally after sync -> keep and push to remote
                    mergedGroupsMap.set(id, { ...localEntry });
                    shouldPushRemote = true;
                }
            }
        }
    }

    // 2b. Merge archivedGroupCache
    const mergedArchivedMap = new Map<string, CachedGroup>();

    // Archived groups present in both localArchived and remoteArchived
    for (const [id, localEntry] of localArchivedMap.entries()) {
        const remoteEntry = remoteArchivedMap.get(id);
        if (remoteEntry) {
            const { winner, updateLocal, pushRemote } = mergeTwoGroupEntries(localEntry, remoteEntry, true);
            if (updateLocal) shouldUpdateLocal = true;
            if (pushRemote) shouldPushRemote = true;
            mergedArchivedMap.set(id, winner);
        }
    }

    // Archived groups only in localArchived
    for (const [id, localEntry] of localArchivedMap.entries()) {
        if (!remoteArchivedMap.has(id)) {
            const remoteActiveEntry = remoteGroupsMap.get(id);
            if (remoteActiveEntry) {
                const localTime = getGroupEntryTime(localEntry);
                const remoteTime = getGroupEntryTime(remoteActiveEntry);
                if (localTime >= remoteTime) {
                    // Local archived it more recently than remote was active
                    const winnerIcon = localEntry.icon ?? remoteActiveEntry.icon;
                    mergedArchivedMap.set(id, { ...localEntry, ...(winnerIcon !== undefined ? { icon: winnerIcon } : {}) });
                    shouldPushRemote = true;
                }
            } else {
                // Only local has this archived group
                mergedArchivedMap.set(id, { ...localEntry });
                shouldPushRemote = true;
            }
        }
    }

    // Archived groups only in remoteArchived
    for (const [id, remoteEntry] of remoteArchivedMap.entries()) {
        if (!localArchivedMap.has(id)) {
            const localActiveEntry = localGroupsMap.get(id);
            if (localActiveEntry) {
                const localTime = getGroupEntryTime(localActiveEntry);
                const remoteTime = getGroupEntryTime(remoteEntry);
                if (remoteTime > localTime) {
                    // Remote archived it more recently than local was active
                    const winnerIcon = remoteEntry.icon ?? localActiveEntry.icon;
                    mergedArchivedMap.set(id, { ...remoteEntry, ...(winnerIcon !== undefined ? { icon: winnerIcon } : {}) });
                    shouldUpdateLocal = true;
                }
            } else {
                // Remote has archived group that local doesn't have
                mergedArchivedMap.set(id, { ...remoteEntry });
                shouldUpdateLocal = true;
            }
        }
    }

    // Ensure no group is present in both active and archived
    for (const id of mergedArchivedMap.keys()) {
        mergedGroupsMap.delete(id);
    }

    // Re-apply isHydrated device-locally
    const mergedGroupList: CachedGroup[] = Array.from(mergedGroupsMap.values()).map(g => {
        const isHydrated = options?.isGroupHydrated ? options.isGroupHydrated(g.id) : g.isHydrated;
        return {
            ...g,
            ...(isHydrated !== undefined ? { isHydrated } : {})
        };
    });

    mergedGroupList.sort((a, b) => parseTimestamp(b.lastAccessed) - parseTimestamp(a.lastAccessed));

    const mergedArchivedList: CachedGroup[] = Array.from(mergedArchivedMap.values()).map(g => {
        const isHydrated = options?.isGroupHydrated ? options.isGroupHydrated(g.id) : g.isHydrated;
        return {
            ...g,
            ...(isHydrated !== undefined ? { isHydrated } : {})
        };
    });

    mergedArchivedList.sort((a, b) => parseTimestamp(b.lastAccessed) - parseTimestamp(a.lastAccessed));

    // 3. Active Group ID (Local-First with Cloud Initial Handoff)
    let activeGroupId: string | null = null;
    const localActive = localDoc.activeGroupId ?? null;
    const remoteActive = remoteDoc.activeGroupId ?? null;

    const localActiveValid = localActive && mergedGroupsMap.has(localActive);
    const remoteActiveValid = remoteActive && mergedGroupsMap.has(remoteActive);

    if (localActiveValid) {
        activeGroupId = localActive;
        // Do NOT mark shouldPushRemote solely due to activeGroupId difference
    } else {
        if (remoteActiveValid) {
            activeGroupId = remoteActive;
        } else {
            activeGroupId = mergedGroupList[0]?.id ?? null;
        }
        if (activeGroupId !== localActive) {
            shouldUpdateLocal = true;
        }
    }

    // 4. Document Timestamps
    const localUpdatedAtTime = parseTimestamp(localDoc.updatedAt || localDoc.lastUpdated);
    const remoteUpdatedAtTime = parseTimestamp(remoteDoc.updatedAt || remoteDoc.lastUpdated);
    const maxUpdatedAtMs = Math.max(localUpdatedAtTime, remoteUpdatedAtTime, Date.now());
    const mergedUpdatedAtIso = new Date(maxUpdatedAtMs).toISOString();

    const mergedDoc: Record<string, any> = {
        id: localDoc.id || remoteDoc.id || "global_settings",
        version: Math.max(Number(localDoc.version) || 1, Number(remoteDoc.version) || 1),
        activeGroupId,
        groupCache: mergedGroupList,
        archivedGroupCache: mergedArchivedList,
        preferences,
        ...(encryptedApiKey !== undefined ? { encryptedApiKey } : {}),
        ...(preferencesUpdatedAt !== undefined ? { preferencesUpdatedAt } : {}),
        lastUpdated: mergedUpdatedAtIso,
        updatedAt: mergedUpdatedAtIso,
        deletedAt: null
    };

    return {
        mergedDoc,
        shouldUpdateLocal,
        shouldPushRemote
    };
}
