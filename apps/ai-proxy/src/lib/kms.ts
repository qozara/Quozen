/**
 * Handles KMS-style encryption/decryption using AES-256-GCM.
 * Enforces use of a 32-byte high-entropy secret.
 */

async function getEncryptionKey(secret: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);

    if (keyData.byteLength !== 32) {
        throw new Error(
            `Invalid KMS_SECRET: Expected 32 bytes, but got ${keyData.byteLength}. ` +
            `The KMS_SECRET must be exactly 32 bytes of cryptographically random data. ` +
            `You can generate one using: openssl rand -base64 32`
        );
    }

    return await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encrypt(text: string, secret: string): Promise<string> {
    const key = await getEncryptionKey(secret);
    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        data
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Using browser-compatible btoa for Edge/Worker compatibility
    return btoa(String.fromCharCode(...combined));
}

export async function decrypt(ciphertextBase64: string, secret: string): Promise<string> {
    const key = await getEncryptionKey(secret);

    // Using browser-compatible atob for Edge/Worker compatibility
    const combined = new Uint8Array(
        atob(ciphertextBase64).split('').map(c => c.charCodeAt(0))
    );

    if (combined.length < 12) {
        throw new Error('Invalid ciphertext: too short');
    }

    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        data
    );

    return new TextDecoder().decode(decrypted);
}

