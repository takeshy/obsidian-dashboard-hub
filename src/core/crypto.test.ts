import { describe, expect, it } from "vitest";
import {
  CURRENT_CRYPTO_VERSION,
  CURRENT_KDF_ITERATIONS,
  unwrapEncryptedFile,
  wrapEncryptedFile,
} from "./crypto";

describe("encrypted file versions", () => {
  it("writes explicit current crypto parameters", () => {
    const content = wrapEncryptedFile("ciphertext", "key", "salt");
    expect(content).toContain(`cryptoVersion: ${CURRENT_CRYPTO_VERSION}`);
    expect(content).toContain("kdf: PBKDF2-SHA256");
    expect(content).toContain(`kdfIterations: ${CURRENT_KDF_ITERATIONS}`);
    expect(unwrapEncryptedFile(content)).toMatchObject({
      cryptoVersion: CURRENT_CRYPTO_VERSION,
      kdfIterations: CURRENT_KDF_ITERATIONS,
    });
  });

  it("keeps legacy unversioned files readable with their original work factor", () => {
    const legacy = "---\nencrypted: true\nkey: key\nsalt: salt\n---\nciphertext";
    expect(unwrapEncryptedFile(legacy)).toMatchObject({
      cryptoVersion: 0,
      kdfIterations: 100_000,
    });
  });

  it("rejects unknown versions instead of silently choosing crypto parameters", () => {
    const future = "---\nencrypted: true\ncryptoVersion: 2\nkdf: PBKDF2-SHA256\nkdfIterations: 600000\nkey: key\nsalt: salt\n---\nciphertext";
    expect(() => unwrapEncryptedFile(future)).toThrow("Unsupported encrypted file version");
  });
});
