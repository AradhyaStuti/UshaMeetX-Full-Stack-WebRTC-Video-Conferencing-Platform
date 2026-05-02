// AES-GCM helpers for end-to-end chat encryption.
// The room key lives in the URL hash, which the browser never sends to the
// server, so the server only ever sees ciphertext.

const ALGO = "AES-GCM";
const KEY_LENGTH = 256;

export async function generateRoomKey() {
    const key = await crypto.subtle.generateKey(
        { name: ALGO, length: KEY_LENGTH },
        true,
        ["encrypt", "decrypt"]
    );
    const raw = await crypto.subtle.exportKey("raw", key);
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

async function importKey(base64Key) {
    const raw = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
    return crypto.subtle.importKey("raw", raw, { name: ALGO }, false, ["encrypt", "decrypt"]);
}

export async function encryptMessage(plaintext, base64Key) {
    const key = await importKey(base64Key);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
        { name: ALGO, iv },
        key,
        encoded
    );

    // Pack IV + ciphertext together so the recipient can split them back out.
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return btoa(String.fromCharCode(...combined));
}

export async function decryptMessage(base64Data, base64Key) {
    try {
        const key = await importKey(base64Key);
        const combined = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);

        const decrypted = await crypto.subtle.decrypt(
            { name: ALGO, iv },
            key,
            ciphertext
        );

        return new TextDecoder().decode(decrypted);
    } catch {
        return "[encrypted message]";
    }
}

export async function getOrCreateRoomKey() {
    const hash = window.location.hash.slice(1);

    if (hash && hash.length >= 20) {
        return { key: hash, isNew: false };
    }

    const key = await generateRoomKey();
    window.history.replaceState(null, "", window.location.pathname + "#" + key);
    return { key, isNew: true };
}
