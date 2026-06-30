export async function generateKeyPair(): Promise<CryptoKeyPair> {
    return await window.crypto.subtle.generateKey(
        {
            name: "ECDH",
            namedCurve: "P-256",
        },
        true, // extractable
        ["deriveKey", "deriveBits"]
    );
}

export async function exportPublicKey(key: CryptoKey): Promise<JsonWebKey> {
    return await window.crypto.subtle.exportKey("jwk", key);
}

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return await window.crypto.subtle.importKey(
        "jwk",
        jwk,
        {
            name: "ECDH",
            namedCurve: "P-256",
        },
        true,
        []
    );
}

export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return await window.crypto.subtle.importKey(
        "jwk",
        jwk,
        {
            name: "ECDH",
            namedCurve: "P-256",
        },
        true,
        ["deriveKey", "deriveBits"]
    );
}

export async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
    return await window.crypto.subtle.deriveKey(
        {
            name: "ECDH",
            public: publicKey,
        },
        privateKey,
        {
            name: "AES-GCM",
            length: 256,
        },
        false, // non-extractable shared secret
        ["encrypt", "decrypt"]
    );
}

export async function encryptText(text: string, sharedSecret: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);

    const encryptedBuf = await window.crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv,
        },
        sharedSecret,
        encoded
    );

    const ciphertext = btoa(String.fromCharCode(...new Uint8Array(encryptedBuf)));
    const ivString = btoa(String.fromCharCode(...iv));

    return { ciphertext, iv: ivString };
}

export async function decryptText(ciphertextBase64: string, ivBase64: string, sharedSecret: CryptoKey): Promise<string> {
    try {
        const iv = new Uint8Array(atob(ivBase64).split('').map(c => c.charCodeAt(0)));
        const encryptedBytes = new Uint8Array(atob(ciphertextBase64).split('').map(c => c.charCodeAt(0)));

        const decryptedBuf = await window.crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: iv,
            },
            sharedSecret,
            encryptedBytes
        );

        return new TextDecoder().decode(decryptedBuf);
    } catch (e) {
        console.error("Failed to decrypt message:", e);
        throw new Error("DecryptionFailed");
    }
}
