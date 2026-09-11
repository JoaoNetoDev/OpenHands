import { describe, expect, it } from "vitest";
import {
  computeVaultLookupId,
  decryptFromVault,
  encryptForVault,
} from "#/api/backend-registry/vault-crypto";

describe("backend vault crypto", () => {
  it("round-trips arbitrary JSON through encrypt/decrypt with the right password", async () => {
    const payload = [{ id: "1", name: "Aqdata", host: "https://aqdata.example" }];
    const envelope = await encryptForVault("correct horse battery staple", payload);

    const decrypted = await decryptFromVault<typeof payload>(
      "correct horse battery staple",
      envelope,
    );

    expect(decrypted).toEqual(payload);
  });

  it("fails to decrypt with the wrong password", async () => {
    const envelope = await encryptForVault("right-password", { a: 1 });

    await expect(
      decryptFromVault("wrong-password", envelope),
    ).rejects.toThrow();
  });

  it("produces different ciphertext for the same plaintext each time (random salt/iv)", async () => {
    const a = await encryptForVault("same-password", { x: 1 });
    const b = await encryptForVault("same-password", { x: 1 });

    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });

  it("derives a stable, URL-safe lookup id from the same password", async () => {
    const id1 = await computeVaultLookupId("hunter2");
    const id2 = await computeVaultLookupId("hunter2");
    const id3 = await computeVaultLookupId("different");

    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id1).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
