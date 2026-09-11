import type { Backend } from "./types";
import {
  computeVaultLookupId,
  decryptFromVault,
  encryptForVault,
  type VaultEnvelope,
} from "./vault-crypto";

/**
 * Same-origin path, proxied directly by Apache to a small standalone service
 * (see /opt/backend-vault on the host) — kept outside of /api so it never
 * collides with the agent-server's own routes.
 */
const VAULT_BASE_PATH = "/vault";

export class VaultRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "VaultRequestError";
  }
}

/** Encrypts the given backends under `password` and uploads them, overwriting any existing vault for that password. */
export async function saveBackendsToVault(
  password: string,
  backends: Backend[],
): Promise<void> {
  const id = await computeVaultLookupId(password);
  const envelope = await encryptForVault(password, backends);
  const response = await fetch(`${VAULT_BASE_PATH}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });
  if (!response.ok) {
    throw new VaultRequestError(
      `Vault save failed (${response.status})`,
      response.status,
    );
  }
}

/**
 * Fetches and decrypts the vault for `password`.
 * Throws VaultRequestError with status 404 if nothing was ever saved under
 * that password, or a plain error if the password is wrong (decryption
 * failure — indistinguishable by design from "wrong password").
 */
export async function loadBackendsFromVault(
  password: string,
): Promise<Backend[]> {
  const id = await computeVaultLookupId(password);
  const response = await fetch(`${VAULT_BASE_PATH}/${id}`);
  if (!response.ok) {
    throw new VaultRequestError(
      `Vault load failed (${response.status})`,
      response.status,
    );
  }
  const envelope = (await response.json()) as VaultEnvelope;
  return decryptFromVault<Backend[]>(password, envelope);
}

export async function deleteBackendsVault(password: string): Promise<void> {
  const id = await computeVaultLookupId(password);
  const response = await fetch(`${VAULT_BASE_PATH}/${id}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new VaultRequestError(
      `Vault delete failed (${response.status})`,
      response.status,
    );
  }
}
