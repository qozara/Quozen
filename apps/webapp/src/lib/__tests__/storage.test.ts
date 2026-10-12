import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getQuozen, initQuozenStorage, resetQuozenStorage, quozen } from "../storage";
import { destroyQuozenDatabase } from "@quozen/core";
import { onlineManager } from "@tanstack/react-query";
import { queryClient } from "../queryClient";

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
        onlineManager.setOnline(true);
        Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
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

    it("executes payment/expense/settings mutations immediately while offline without pausing", async () => {
        await initQuozenStorage();
        const groupId = "offline-group-1";

        // Seed members and a settlement in local RxDB
        const client = getQuozen();
        await client.db!.members.bulkUpsert([
            {
                id: `${groupId}_user-1`,
                groupId,
                userId: "user-1",
                email: "alice@example.com",
                name: "Alice",
                role: "owner",
                joinedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                deletedAt: null
            },
            {
                id: `${groupId}_user-2`,
                groupId,
                userId: "user-2",
                email: "bob@example.com",
                name: "Bob",
                role: "member",
                joinedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                deletedAt: null
            }
        ]);

        const createdSettlement = await quozen.ledger(groupId).addSettlement({
            fromUserId: "user-2",
            toUserId: "user-1",
            amount: 25,
            method: "cash",
            date: new Date()
        });

        // Switch browser and TanStack Query onlineManager to offline
        Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
        onlineManager.setOnline(false);
        expect(onlineManager.isOnline()).toBe(false);

        // Execute mutation through queryClient using its defaultOptions (networkMode: 'always')
        const defaultMutationOptions = queryClient.defaultMutationOptions({
            mutationFn: async (newAmount: number) => {
                await quozen.ledger(groupId).updateSettlement(createdSettlement.id, {
                    fromUserId: "user-2",
                    toUserId: "user-1",
                    amount: newAmount,
                    method: "venmo",
                    notes: "Edited while offline",
                    date: new Date()
                });
            }
        });
        expect(queryClient.getDefaultOptions().mutations?.networkMode).toBe("always");
        expect(queryClient.getDefaultOptions().queries?.networkMode).toBe("always");

        const mutation = queryClient.getMutationCache().build(queryClient, defaultMutationOptions);
        await mutation.execute(45);

        expect(mutation.state.status).toBe("success");
        expect(mutation.state.isPaused).toBe(false);

        const settlements = await quozen.ledger(groupId).getSettlements();
        expect(settlements).toHaveLength(1);
        expect(settlements[0].amount).toBe(45);
        expect(settlements[0].method).toBe("venmo");
        expect(settlements[0].notes).toBe("Edited while offline");
    });
});

