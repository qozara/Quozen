import { describe, it, expect, beforeEach, vi } from "vitest";
import { GroupRepository } from "../../src/infrastructure/GroupRepository";
import { LedgerRepository } from "../../src/infrastructure/LedgerRepository";
import { InMemoryAdapter } from "../../src/storage/memory-adapter";
import { User } from "../../src/domain/models";
import { userSettingsSchema } from "../../src/db/schemas";

describe("Group Icon & Metadata Tab (Issue: Group Icon)", () => {
    let adapter: InMemoryAdapter;
    let repo: GroupRepository;
    const user: User = {
        id: "u1",
        name: "Test User",
        email: "test@example.com",
        username: "test"
    };

    beforeEach(() => {
        adapter = new InMemoryAdapter();
        repo = new GroupRepository(adapter as any, user);
    });

    describe("RxDB User Settings Schema with Group Icon", () => {
        it("userSettingsSchema contains icon in groupCache and archivedGroupCache", () => {
            expect(userSettingsSchema.version).toBeGreaterThanOrEqual(2);
            const groupCacheProps = (userSettingsSchema.properties.groupCache as any).items.properties;
            const archivedCacheProps = (userSettingsSchema.properties.archivedGroupCache as any).items.properties;
            expect(groupCacheProps.icon).toBeDefined();
            expect(archivedCacheProps.icon).toBeDefined();
        });
    });

    describe("Group Creation & Edition with Icon", () => {
        it("creates a group with preset icon and stores it in _meta tab and groupCache", async () => {
            const icon = "preset:plane";
            const group = await repo.create("Vacation 2026", [], { icon });

            expect(group.icon).toBe(icon);

            const settings = await repo.getSettings();
            const cached = settings.groupCache.find(g => g.id === group.id);
            expect(cached?.icon).toBe(icon);

            // Verify _meta tab in spreadsheet
            const metaValues = await (adapter as any).batchGetValues(group.id, ["_meta!A1:C10"]);
            const rows = metaValues[0]?.values || [];
            expect(rows[0]).toEqual(["key", "value", "updatedAt"]);
            const iconRow = rows.find((r: string[]) => r[0] === "icon");
            expect(iconRow).toBeDefined();
            expect(iconRow[1]).toBe(icon);
        });

        it("creates a group with custom data URL icon", async () => {
            const dataUrl = "data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoAAP7/2QAA";
            const group = await repo.create("Custom Photo Group", [], { icon: dataUrl });

            expect(group.icon).toBe(dataUrl);

            const settings = await repo.getSettings();
            const cached = settings.groupCache.find(g => g.id === group.id);
            expect(cached?.icon).toBe(dataUrl);
        });

        it("updates group icon and syncs to _meta tab and groupCache", async () => {
            const initialIcon = "preset:home";
            const group = await repo.create("Roommates", [], { icon: initialIcon });

            const newIcon = "preset:party";
            await repo.updateGroup(group.id, "Roommates Party", [], { icon: newIcon });

            const settings = await repo.getSettings();
            const cached = settings.groupCache.find(g => g.id === group.id);
            expect(cached?.name).toBe("Roommates Party");
            expect(cached?.icon).toBe(newIcon);

            // Verify updated in _meta tab
            const metaValues = await (adapter as any).batchGetValues(group.id, ["_meta!A1:C10"]);
            const rows = metaValues[0]?.values || [];
            const iconRow = rows.find((r: string[]) => r[0] === "icon");
            expect(iconRow?.[1]).toBe(newIcon);
        });

        it("allows clearing group icon when editing", async () => {
            const group = await repo.create("Tech Club", [], { icon: "preset:briefcase" });
            await repo.updateGroup(group.id, "Tech Club", [], { icon: "" });

            const settings = await repo.getSettings();
            const cached = settings.groupCache.find(g => g.id === group.id);
            expect(cached?.icon).toBe("");
        });

        it("populates missing icon in groupCache from _meta when updateActiveGroup is called", async () => {
            const group = await repo.create("Hiking Club", [], { icon: "preset:mountain" });

            // Switch active group away first so updateActiveGroup doesn't no-op early
            const settings0 = await repo.getSettings();
            settings0.activeGroupId = "other-group";
            await repo.saveSettings(settings0);

            // Simulate cachedGroup losing icon (e.g. from older client or drive scan before meta was read)
            const settings = await repo.getSettings();
            const cached = settings.groupCache.find(g => g.id === group.id)!;
            delete cached.icon;
            await repo.saveSettings(settings);

            const beforeActivate = await repo.getSettings();
            expect(beforeActivate.groupCache.find(g => g.id === group.id)?.icon).toBeUndefined();

            // Calling updateActiveGroup should restore icon from _meta
            await repo.updateActiveGroup(group.id);

            const afterActivate = await repo.getSettings();
            expect(afterActivate.groupCache.find(g => g.id === group.id)?.icon).toBe("preset:mountain");
        });

        it("populates missing icon in groupCache from _meta even if group is ALREADY the activeGroupId", async () => {
            const group = await repo.create("Camping Trip", [], { icon: "preset:tent" });

            // Ensure group is activeGroupId
            const settings = await repo.getSettings();
            expect(settings.activeGroupId).toBe(group.id);

            // Simulate icon missing from cache on reload
            const cached = settings.groupCache.find(g => g.id === group.id)!;
            delete cached.icon;
            await repo.saveSettings(settings);

            const reloadedSettings = await repo.getSettings();
            expect(reloadedSettings.groupCache.find(g => g.id === group.id)?.icon).toBeUndefined();

            // When updateActiveGroup is called on reload with the SAME active group
            await repo.updateActiveGroup(group.id);

            const finalSettings = await repo.getSettings();
            expect(finalSettings.groupCache.find(g => g.id === group.id)?.icon).toBe("preset:tent");
        });

        it("safeguards against writing oversized icon (> 49000 chars) to _meta tab during create and updateGroup", async () => {
            const oversizedIcon = "data:image/jpeg;base64," + "X".repeat(55000);

            // In create: should not write cell with > 49000 chars to _meta tab
            const group = await repo.create("Big Photo Club", [], { icon: oversizedIcon });
            expect(group.id).toBeDefined();

            const metaValues = await (adapter as any).batchGetValues(group.id, ["_meta!A1:C10"]);
            const rows = metaValues[0]?.values || [];
            const iconRow = rows.find((r: string[]) => r[0] === "icon");
            // Icon row should either not be present or not exceed 49000 chars
            if (iconRow) {
                expect(iconRow[1].length).toBeLessThanOrEqual(49000);
            }

            // In updateGroup: updating with oversized icon should not write oversized cell to _meta
            await repo.updateGroup(group.id, "Big Photo Club Renamed", [], { icon: oversizedIcon });
            const metaValuesAfter = await (adapter as any).batchGetValues(group.id, ["_meta!A1:C10"]);
            const rowsAfter = metaValuesAfter[0]?.values || [];
            const iconRowAfter = rowsAfter.find((r: string[]) => r[0] === "icon");
            if (iconRowAfter) {
                expect(iconRowAfter[1].length).toBeLessThanOrEqual(49000);
            }
        });

        it("does not repeatedly call batchGetValues or checkFileHealth when updateActiveGroup is called on a group with NO icon", async () => {
            const group = await repo.create("Book Club", []);
            // Group has no icon. Activate once.
            await repo.updateActiveGroup(group.id);

            const batchGetSpy = vi.spyOn(adapter, "batchGetValues");
            const checkHealthSpy = vi.spyOn(repo as any, "checkFileHealth");

            // Calling updateActiveGroup again for the SAME active group
            await repo.updateActiveGroup(group.id);

            expect(batchGetSpy).not.toHaveBeenCalled();
            expect(checkHealthSpy).not.toHaveBeenCalled();
        });

        it("caches missing icon so LedgerRepository.getGroupIcon does not repeatedly query _meta", async () => {
            const group = await repo.create("Coffee Lovers", []);
            const ledgerRepo = new LedgerRepository(adapter as any, group.id);

            // First call might hit adapter if not cached
            await ledgerRepo.getGroupIcon();

            const batchGetSpy = vi.spyOn(adapter, "batchGetValues");

            // Second call MUST not hit adapter
            const icon = await ledgerRepo.getGroupIcon();
            expect(icon).toBeUndefined();
            expect(batchGetSpy).not.toHaveBeenCalled();
        });
    });
});
