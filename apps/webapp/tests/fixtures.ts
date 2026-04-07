import { test as base, expect } from '@playwright/test';
import { MockServer } from './mock-server';
import { isMockMode } from './utils';

type Fixtures = {
    mockServer: MockServer;
};

export const test = base.extend<Fixtures>({
    mockServer: [async ({ context }, use) => {
        const server = new MockServer();
        if (isMockMode) {
            await context.route('**/_test/storage/**', route => server.handle(route));
        }
        await use(server);
    }, { auto: true }], // Ensure mock server network interception is applied universally
});

export { expect };
