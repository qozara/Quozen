import { describe, it, expect, beforeEach } from "vitest";
import { GroupRepository } from "../../src/infrastructure/GroupRepository";
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
    });
});
