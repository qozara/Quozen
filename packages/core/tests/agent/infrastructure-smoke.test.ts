import { describe, it, expect, beforeAll } from 'vitest';
import { QuozenClient, GoogleDriveStorageLayer, QuozenAI, ProxyAiProvider } from '../../src';
import { getLocalCredentials, refreshLocalAccessToken } from '../utils/local-credentials';
import * as dotenv from 'dotenv';
import * as path from 'path';

const shouldRun = !process.env.CI && process.env.RUN_LOCAL_LLM_TESTS === 'true';

describe.runIf(shouldRun)('AI Goal: Infrastructure Pipeline (Edge Proxy + Google Drive)', () => {
    let client: QuozenClient;
    let ai: QuozenAI;
    let groupId: string;
    let bobId: string;

    beforeAll(async () => {
        const envPath = process.cwd().endsWith('core') ? path.resolve(process.cwd(), '../../.env') : path.resolve(process.cwd(), '.env');
        dotenv.config({ path: envPath });

        let creds = await getLocalCredentials();
        if (!creds) throw new Error("No local credentials found. Run CLI login first.");
        if (Date.now() >= creds.expiry_date - 60000) {
            creds = await refreshLocalAccessToken(creds);
        }

        const storage = new GoogleDriveStorageLayer(() => creds.access_token);
        client = new QuozenClient({ storage, user: creds.user });

        const settings = await client.groups.getSettings();
        const oldTestGroups = settings.groupCache.filter(g => g.name === "AI Infrastructure Smoke Test");
        for (const g of oldTestGroups) {
            try { await client.groups.deleteGroup(g.id); } catch (e) { }
        }

        const proxyUrl = (process.env.VITE_AI_PROXY_URL || 'http://127.0.0.1:8788').replace('localhost', '127.0.0.1');
        const provider = new ProxyAiProvider(proxyUrl, () => creds.access_token);
        ai = new QuozenAI(client, provider);

        const group = await client.groups.create("AI Infrastructure Smoke Test", [{ username: "bob" }]);
        groupId = group.id;

        const ledger = await client.ledger(groupId).getLedger();
        const bob = ledger.members.find(m => m.name.toLowerCase() === 'bob');
        if (!bob) throw new Error("Bob not found");
        bobId = bob.userId;
    }, 60000);

    it('should run end-to-end user journey via AI Proxy', async () => {
        // Step 2. Prompt: "I paid $100 for dinner."
        const res1 = await ai.executeCommand("I paid $100 for dinner.", groupId, "en");
        console.log('AI Response 1:', res1.message);
        expect(res1.success, `Failed to add expense: ${res1.message}`).toBe(true);

        const ledgerService = client.ledger(groupId);
        let ledger = await ledgerService.getLedger();

        expect(ledger.expenses).toHaveLength(1);
        expect(ledger.expenses[0].amount).toBe(100);

        // Step 3. Prompt: "Bob paid me his share."
        const bob = ledger.members.find(m => m.userId === bobId)!;
        const res2 = await ai.executeCommand(`${bob.name} paid ${client.user.name} $50`, groupId, "en");
        console.log('AI Response 2:', res2.message);
        expect(res2.success, `Failed to add settlement: ${res2.message}`).toBe(true);

        ledger = await ledgerService.getLedger();

        // Step 4. Assert real Google Drive ledger shows Bob's balance is exactly $0.
        const balances2 = ledger.getBalances();
        expect(balances2[bobId], `Bob ID ${bobId} balance is ${balances2[bobId]}. Full balances: ${JSON.stringify(balances2)}`).toBe(0);

        await client.groups.deleteGroup(groupId);
    }, 240000);
});
