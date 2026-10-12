import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getQuozen, initQuozenStorage, resetQuozenStorage, quozen } from "../storage";
import { destroyQuozenDatabase } from "@quozen/core";

describe("WebApp Storage & RxDB Initialization", () => {
    beforeEach(async () => {
        localStorage.setItem(
            "quozen_user_profile",
            JSON.stringify({
                id: "user-1",
                username: "alice",
                email: "alice@example.com",
                name: "Alice"
            })
        );
        await resetQuozenStorage();
    });

    afterEach(async () => {
        await resetQuozenStorage();
        await destroyQuozenDatabase();
        localStorage.clear();
    });

    it("initializes RxDB and exposes ReplicationCoordinator on QuozenClient", async () => {
        const db = await initQuozenStorage();
        expect(db).toBeDefined();
        expect(db.collections.expenses).toBeDefined();
        expect(db.collections.settlements).toBeDefined();
        expect(db.collections.members).toBeDefined();
        expect(db.collections.user_settings).toBeDefined();

        const client = getQuozen();
        expect(client.db).toBe(db);
        expect(client.replication).toBeDefined();
        expect(quozen.replication).toBe(client.replication);
    });
});
