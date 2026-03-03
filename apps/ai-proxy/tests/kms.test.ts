import { describe, it, expect, beforeEach } from 'vitest';
import { encrypt, decrypt } from '../src/lib/kms';
import { webcrypto } from 'node:crypto';

// Polyfill crypto for Node environment
if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as any;
}

describe('KMS Library', () => {
    const VALID_SECRET = '0123456789abcdef0123456789abcdef';
    const INVALID_SECRET_SHORT = 'too-short';
    const INVALID_SECRET_LONG = 'this-secret-is-definitely-much-longer-than-32-bytes-long';

    it('should encrypt and decrypt with a valid 32-byte secret', async () => {
        const text = 'hello-world';
        const ciphertext = await encrypt(text, VALID_SECRET);
        expect(ciphertext).toBeDefined();
        expect(typeof ciphertext).toBe('string');

        const decrypted = await decrypt(ciphertext, VALID_SECRET);
        expect(decrypted).toBe(text);
    });

    it('should throw error when encrypting with a short secret', async () => {
        await expect(encrypt('test', INVALID_SECRET_SHORT)).rejects.toThrow(/Invalid KMS_SECRET/);
    });

    it('should throw error when decrypting with a short secret', async () => {
        await expect(decrypt('some-ciphertext', INVALID_SECRET_SHORT)).rejects.toThrow(/Invalid KMS_SECRET/);
    });

    it('should throw error when encrypting with a long secret', async () => {
        await expect(encrypt('test', INVALID_SECRET_LONG)).rejects.toThrow(/Invalid KMS_SECRET/);
    });

    it('should throw error with invalid ciphertext during decryption', async () => {
        const invalidBase64 = btoa('tiny');
        await expect(decrypt(invalidBase64, VALID_SECRET)).rejects.toThrow(/Invalid ciphertext/);
    });

    it('should produce different ciphertexts for the same input (unique IV)', async () => {
        const text = 'same-text';
        const cipher1 = await encrypt(text, VALID_SECRET);
        const cipher2 = await encrypt(text, VALID_SECRET);
        expect(cipher1).not.toBe(cipher2);
    });
});
