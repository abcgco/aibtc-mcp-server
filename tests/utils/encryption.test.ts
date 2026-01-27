import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  randomBytes,
  generateWalletId,
} from "../../src/utils/encryption.js";

describe("encryption", () => {
  describe("encrypt/decrypt", () => {
    it("should encrypt and decrypt a string successfully", async () => {
      const plaintext = "my secret mnemonic words";
      const password = "strongPassword123";

      const encrypted = await encrypt(plaintext, password);
      const decrypted = await decrypt(encrypted, password);

      expect(decrypted).toBe(plaintext);
    });

    it("should throw when decrypting with wrong password", async () => {
      const plaintext = "my secret mnemonic words";
      const password = "correctPassword";
      const wrongPassword = "wrongPassword";

      const encrypted = await encrypt(plaintext, password);

      await expect(decrypt(encrypted, wrongPassword)).rejects.toThrow(
        "Decryption failed"
      );
    });

    it("should produce encrypted data with correct structure", async () => {
      const plaintext = "test data";
      const password = "password123";

      const encrypted = await encrypt(plaintext, password);

      expect(encrypted).toHaveProperty("version");
      expect(encrypted).toHaveProperty("iv");
      expect(encrypted).toHaveProperty("salt");
      expect(encrypted).toHaveProperty("authTag");
      expect(encrypted).toHaveProperty("ciphertext");
      expect(encrypted).toHaveProperty("scryptParams");

      expect(encrypted.version).toBe(1);
      expect(typeof encrypted.iv).toBe("string");
      expect(typeof encrypted.salt).toBe("string");
      expect(typeof encrypted.authTag).toBe("string");
      expect(typeof encrypted.ciphertext).toBe("string");
      expect(encrypted.scryptParams).toHaveProperty("N");
      expect(encrypted.scryptParams).toHaveProperty("r");
      expect(encrypted.scryptParams).toHaveProperty("p");
      expect(encrypted.scryptParams).toHaveProperty("keyLen");
    });
  });

  describe("randomBytes", () => {
    it("should generate buffer of correct length", () => {
      const bytes = randomBytes(16);
      expect(Buffer.isBuffer(bytes)).toBe(true);
      expect(bytes.length).toBe(16);
    });

    it("should generate different values each time", () => {
      const bytes1 = randomBytes(32);
      const bytes2 = randomBytes(32);
      expect(bytes1.equals(bytes2)).toBe(false);
    });
  });

  describe("generateWalletId", () => {
    it("should generate valid UUID format", () => {
      const walletId = generateWalletId();
      expect(typeof walletId).toBe("string");
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(walletId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("should generate unique IDs", () => {
      const id1 = generateWalletId();
      const id2 = generateWalletId();
      expect(id1).not.toBe(id2);
    });
  });
});
