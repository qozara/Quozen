import { test, expect } from './fixtures';
import { MockServer } from './mock-server';
import {
    isMockMode,
    setupAuth,
    setupTestEnvironment,
    getAccessToken,
    findFiles,
    deleteFile,
    createEmptySettingsFile,
    createDummyGroup,
    fetchFileContent
} from './utils';

const SETTINGS_FILE_NAME = "quozen-settings.json";

test.describe.serial('Google Drive Persistence Reproduction', () => {
    test.setTimeout(300000); // 5 minutes suite timeout
    let accessToken: string;
    let userProfile: string;

    test.beforeAll(async ({ browser }) => {
        // Prepare a page to get token
        const tempServer = new MockServer();
        const context = await browser.newContext();
        await setupTestEnvironment(context, tempServer);
        const page = await context.newPage();

        await setupAuth(page); // Injects mock token if mock mode

        // Need to visit page to init localStorage
        await page.goto('/');

        accessToken = await getAccessToken(page);
        userProfile = await page.evaluate(() => localStorage.getItem("quozen_user_profile") || "");

        if (!userProfile) console.warn("User profile not found in localStorage!");
        console.log("Access Token and Profile acquired.");

        await context.close();
    });

    test.beforeEach(async ({ context, mockServer }) => {
        if (!isMockMode) {
            const request = context.request;

            const files = await findFiles(request, accessToken, `name = '${SETTINGS_FILE_NAME}'`, mockServer);
            for (const file of files) {
                console.log(`Deleting existing settings file: ${file.id}`);
                await deleteFile(request, accessToken, file.id, mockServer);
            }
        }
    });

    test('Reproduction: App cleans up duplicate settings files on load (Self-Healing)', async ({ browser, mockServer }) => {
        const context = await browser.newContext();
        await setupTestEnvironment(context, mockServer);

        // 1. Manually create TWO settings files to simulate a race condition anomaly
        await createEmptySettingsFile(context.request, accessToken, mockServer);
        await createEmptySettingsFile(context.request, accessToken, mockServer);

        // Verify there are at least 2
        let files = await findFiles(context.request, accessToken, `name = '${SETTINGS_FILE_NAME}'`, mockServer);
        expect(files.length).toBeGreaterThanOrEqual(2);

        // 2. Open app and let it load (this triggers getSettings -> deduplication cleanup)
        await context.addInitScript(({ token, profile }) => {
            localStorage.setItem("quozen_access_token", token);
            if (profile) localStorage.setItem("quozen_user_profile", profile);
        }, { token: accessToken, profile: userProfile });

        const page = await context.newPage();
        await page.goto('/');

        // Wait for stabilization
        await page.waitForTimeout(5000);

        // Check Drive for duplicates
        files = await findFiles(context.request, accessToken, `name = '${SETTINGS_FILE_NAME}'`, mockServer);
        expect(files.length, 'App should have cleaned up duplicates leaving exactly one settings file').toBe(1);

        await context.close();
    });

    test('Reproduction: App should handle empty settings file gracefully', async ({ browser, mockServer }) => {
        const context = await browser.newContext();
        await setupTestEnvironment(context, mockServer); // Hook routes

        // Ensure empty settings file exists
        await createEmptySettingsFile(context.request, accessToken, mockServer);

        await context.addInitScript(({ token, profile }) => {
            localStorage.setItem("quozen_access_token", token);
            if (profile) localStorage.setItem("quozen_user_profile", profile);
        }, { token: accessToken, profile: userProfile });

        const page = await context.newPage();
        await page.goto('/');

        await page.waitForTimeout(5000);

        const files = await findFiles(context.request, accessToken, `name = '${SETTINGS_FILE_NAME}'`, mockServer);
        expect(files.length).toBeGreaterThan(0);

        const text = await fetchFileContent(context.request, accessToken, files[0].id, mockServer);

        // The expectation for a working app: it should have repaired the file.
        // If this test fails, it mimics the user report (file creates empty/stays empty).
        expect(text.length, 'App should have repaired the empty file').toBeGreaterThan(2);
        expect(() => JSON.parse(text)).not.toThrow();

        await context.close();
    });

    test('Reproduction: Reconciliation should find existing groups', async ({ browser, mockServer }) => {
        const context = await browser.newContext();
        await setupTestEnvironment(context, mockServer);

        // Setup: No settings file (handled by beforeEach), but some group files exist.
        const groupName = `ReproGroup_${Date.now()}`;
        const groupFile = await createDummyGroup(context.request, accessToken, groupName, mockServer);
        console.log(`Created dummy group: ${groupFile.name} (${groupFile.id})`);

        try {
            await context.addInitScript(({ token, profile }) => {
                localStorage.setItem("quozen_access_token", token);
                if (profile) localStorage.setItem("quozen_user_profile", profile);
            }, { token: accessToken, profile: userProfile });

            const page = await context.newPage();
            // Go to Profile to trigger scan manually (or usually it scans on first load if missing settings)

            await page.goto('/');

            // Wait for UI to update
            await expect(page.getByText(groupName)).toBeVisible({ timeout: 10000 });

        } finally {
            // Cleanup group
            await deleteFile(context.request, accessToken, groupFile.id, mockServer);
            await context.close();
        }
    });

});
