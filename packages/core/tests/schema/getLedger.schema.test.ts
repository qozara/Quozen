import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuozenClient } from '../../src/QuozenClient';
import { IStorageLayer } from '../../src/infrastructure/IStorageLayer';
import { SchemaCorruptedError, SchemaUpgradeRequiredError } from '../../src/errors';
import { ValidationService, ValidationStatus } from '../../src/schema/ValidationService';

vi.mock('../../src/schema/ValidationService');

describe('getLedger() schema validation', () => {
    let mockStorage: any;
    let client: QuozenClient;

    beforeEach(() => {
        mockStorage = {
            batchGetValues: vi.fn().mockResolvedValue([{ values: [] }]),
            getSpreadsheet: vi.fn().mockResolvedValue({ sheets: [] }),
            getFile: vi.fn().mockResolvedValue({ properties: { quozen_type: 'group' } }),
            listFiles: vi.fn().mockResolvedValue([]),
        } as unknown as IStorageLayer;

        client = new QuozenClient({
            storage: mockStorage,
            user: { id: 'u1', email: 'test@example.com', name: 'Test', username: 'Test' },
            getToken: () => 'fake-token'
        });
    });

    it('throws SchemaCorruptedError when status is CORRUPTED', async () => {
        vi.spyOn(ValidationService.prototype, 'checkHealth').mockResolvedValue({
            spreadsheetId: 'group-1',
            currentVersion: 1,
            latestVersion: 1,
            status: ValidationStatus.CORRUPTED,
            missingTabs: ['Expenses'],
            missingColumns: {},
            canAutoMigrate: false,
            lastModifiedTime: ''
        });

        const ledgerSvc = client.ledger('group-1');
        await expect(ledgerSvc.getLedger()).rejects.toThrow(SchemaCorruptedError);
    });

    it('throws SchemaUpgradeRequiredError when status is UPGRADE_REQUIRED', async () => {
        vi.spyOn(ValidationService.prototype, 'checkHealth').mockResolvedValue({
            spreadsheetId: 'group-1',
            currentVersion: 1,
            latestVersion: 2,
            status: ValidationStatus.UPGRADE_REQUIRED,
            missingTabs: [],
            missingColumns: {},
            canAutoMigrate: true,
            lastModifiedTime: ''
        });

        const ledgerSvc = client.ledger('group-1');
        await expect(ledgerSvc.getLedger()).rejects.toThrow(SchemaUpgradeRequiredError);
    });

    it('returns ledger successfully when status is READY', async () => {
        vi.spyOn(ValidationService.prototype, 'checkHealth').mockResolvedValue({
            spreadsheetId: 'group-1',
            currentVersion: 1,
            latestVersion: 1,
            status: ValidationStatus.READY,
            missingTabs: [],
            missingColumns: {},
            canAutoMigrate: false,
            lastModifiedTime: ''
        });

        const ledgerSvc = client.ledger('group-1');
        const ledger = await ledgerSvc.getLedger();
        expect(ledger).toBeDefined();
    });
});
