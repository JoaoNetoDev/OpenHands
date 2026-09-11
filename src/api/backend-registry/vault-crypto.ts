/**
 * Client-side crypto for the password-protected backend vault.
 *
 * The server never sees the password or the plaintext backend list — it only
 * stores an opaque blob keyed by a lookup id. Both the lookup id and the
 * encryption key are derived from the password with PBKDF2; the server can't
 * reconstruct either without it.
 *
 *   lookupId   = SHA-256("openhands-backend-vault-lookup:" + password)
 *   encryptKey = PBKDF2(password, salt, 210_000 iters, SHA-256) -> AES-256-GCM
 *
 * `salt` and `iv` aren't secret and are stored alongside the ciphertext so
 * the same key can be re-derived on another device.
 */

const PBKDF2_ITERATIONS = 210_000;
const LOOKUP_ID_PREFIX = "openhands-backend-vault-lookup:";

export interface VaultEnvelope {
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  /** base64 */
  ciphertext: string;
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function computeVaultLookupId(password: string): Promise<string> {
  const encoded = new TextEncoder().encode(LOOKUP_ID_PREFIX + password);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toBase64(digest)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function deriveAesKey(
  password: string,
  salt: BufferSource,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptForVault(
  password: string,
  data: unknown,
): Promise<VaultEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  return {
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

/**
 * Throws if the password is wrong (AES-GCM auth tag fails to verify) or the
 * envelope is malformed — callers should show a generic "wrong password or
 * corrupted vault" message rather than distinguishing the two.
 */
export async function decryptFromVault<T>(
  password: string,
  envelope: VaultEnvelope,
): Promise<T> {
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  const key = await deriveAesKey(password, salt as BufferSource);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
