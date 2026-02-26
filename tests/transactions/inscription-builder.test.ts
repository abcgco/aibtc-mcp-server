import { describe, it, expect } from "vitest";
import * as btc from "@scure/btc-signer";
import {
  deriveRevealScript,
  buildCommitTransaction,
  buildRevealTransaction,
  type InscriptionData,
} from "../../src/transactions/inscription-builder.js";
import {
  deriveBitcoinKeyPair,
  deriveTaprootAddress,
} from "../../src/utils/bitcoin.js";
import type { UTXO } from "../../src/services/mempool-api.js";

describe("inscription-builder", () => {
  // Test mnemonic from BIP84 test vectors
  const TEST_MNEMONIC =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

  // Derive key pair for testing (P2WPKH, 33-byte compressed pubkey)
  const testKeyPair = deriveBitcoinKeyPair(TEST_MNEMONIC, "mainnet");
  const testPubKey = testKeyPair.publicKeyBytes;

  // Derive a taproot address for the inscription recipient
  const testTaprootAddress = deriveTaprootAddress(TEST_MNEMONIC, "mainnet").address;

  // Sample inscription for tests
  const TEST_INSCRIPTION: InscriptionData = {
    contentType: "text/plain",
    body: new TextEncoder().encode("Hello, Ordinals!"),
  };

  // Create mock confirmed UTXO
  const createMockUtxo = (
    txid: string,
    vout: number,
    value: number,
    confirmed = true
  ): UTXO => ({
    txid,
    vout,
    value,
    status: {
      confirmed,
      block_height: confirmed ? 800000 : undefined,
    },
  });

  describe("deriveRevealScript", () => {
    it("should return P2TR output with address, script, and tapLeafScript", () => {
      const result = deriveRevealScript({
        inscription: TEST_INSCRIPTION,
        senderPubKey: testPubKey,
        network: "mainnet",
      });

      expect(result.address).toBeDefined();
      expect(typeof result.address).toBe("string");
      expect(result.address).toMatch(/^bc1p/);
      expect(result.script).toBeInstanceOf(Uint8Array);
      expect(result.script!.byteLength).toBeGreaterThan(0);
      expect(result.tapLeafScript).toBeDefined();
      expect(Array.isArray(result.tapLeafScript)).toBe(true);
      expect(result.tapLeafScript!.length).toBeGreaterThan(0);
    });

    it("should be deterministic for the same inputs", () => {
      const result1 = deriveRevealScript({
        inscription: TEST_INSCRIPTION,
        senderPubKey: testPubKey,
        network: "mainnet",
      });

      const result2 = deriveRevealScript({
        inscription: TEST_INSCRIPTION,
        senderPubKey: testPubKey,
        network: "mainnet",
      });

      expect(result1.address).toBe(result2.address);
    });

    it("should produce different address for different inscription content", () => {
      const result1 = deriveRevealScript({
        inscription: TEST_INSCRIPTION,
        senderPubKey: testPubKey,
        network: "mainnet",
      });

      const result2 = deriveRevealScript({
        inscription: {
          contentType: "text/plain",
          body: new TextEncoder().encode("Different content"),
        },
        senderPubKey: testPubKey,
        network: "mainnet",
      });

      expect(result1.address).not.toBe(result2.address);
    });

    it("should produce different address for different content types", () => {
      const result1 = deriveRevealScript({
        inscription: TEST_INSCRIPTION,
        senderPubKey: testPubKey,
        network: "mainnet",
      });

      const result2 = deriveRevealScript({
        inscription: {
          contentType: "application/json",
          body: TEST_INSCRIPTION.body,
        },
        senderPubKey: testPubKey,
        network: "mainnet",
      });

      expect(result1.address).not.toBe(result2.address);
    });

    it("should produce testnet address starting with tb1p for testnet network", () => {
      const testnetKeyPair = deriveBitcoinKeyPair(TEST_MNEMONIC, "testnet");

      const result = deriveRevealScript({
        inscription: TEST_INSCRIPTION,
        senderPubKey: testnetKeyPair.publicKeyBytes,
        network: "testnet",
      });

      expect(result.address).toMatch(/^tb1p/);
    });

    it("should produce different addresses for mainnet vs testnet", () => {
      const mainnetResult = deriveRevealScript({
        inscription: TEST_INSCRIPTION,
        senderPubKey: testPubKey,
        network: "mainnet",
      });

      const testnetKeyPair = deriveBitcoinKeyPair(TEST_MNEMONIC, "testnet");
      const testnetResult = deriveRevealScript({
        inscription: TEST_INSCRIPTION,
        senderPubKey: testnetKeyPair.publicKeyBytes,
        network: "testnet",
      });

      expect(mainnetResult.address).not.toBe(testnetResult.address);
    });
  });

  describe("buildRevealTransaction", () => {
    // Helper: build a commit tx to get a valid revealScript
    function buildTestCommit(inscriptionValue = 500000) {
      const mockUtxo = createMockUtxo(
        "0000000000000000000000000000000000000000000000000000000000000001",
        0,
        inscriptionValue
      );

      return buildCommitTransaction({
        utxos: [mockUtxo],
        inscription: TEST_INSCRIPTION,
        feeRate: 10,
        senderPubKey: testPubKey,
        senderAddress: testKeyPair.address,
        network: "mainnet",
      });
    }

    it("should produce a transaction that can be signed and finalized without throwing", () => {
      // This is the regression test for the tapLeafScript fix.
      // Before the fix, finalize() threw "No inputs signed" because tapLeafScript
      // was spread (...revealScript.tapLeafScript) instead of assigned directly.
      const commitResult = buildTestCommit();

      // Use a fake but valid commit txid (64 hex chars)
      const fakeCommitTxid = "a".repeat(64);

      const revealResult = buildRevealTransaction({
        commitTxid: fakeCommitTxid,
        commitVout: 0,
        commitAmount: commitResult.revealAmount,
        revealScript: commitResult.revealScript,
        recipientAddress: testTaprootAddress,
        feeRate: 10,
        network: "mainnet",
      });

      expect(revealResult.tx).toBeInstanceOf(btc.Transaction);

      // Sign with the test private key
      revealResult.tx.sign(testKeyPair.privateKey);

      // Finalize must not throw — this is the key assertion proving the fix
      expect(() => revealResult.tx.finalize()).not.toThrow();
    });

    it("should produce correct fee and output amount that sum to commit amount", () => {
      const commitResult = buildTestCommit();
      const commitAmount = commitResult.revealAmount;

      const revealResult = buildRevealTransaction({
        commitTxid: "b".repeat(64),
        commitVout: 0,
        commitAmount,
        revealScript: commitResult.revealScript,
        recipientAddress: testTaprootAddress,
        feeRate: 10,
        network: "mainnet",
      });

      expect(revealResult.fee).toBeGreaterThan(0);
      expect(revealResult.outputAmount).toBeGreaterThan(0);
      expect(revealResult.outputAmount + revealResult.fee).toBe(commitAmount);
    });

    it("should return a Transaction instance", () => {
      const commitResult = buildTestCommit();

      const revealResult = buildRevealTransaction({
        commitTxid: "c".repeat(64),
        commitVout: 0,
        commitAmount: commitResult.revealAmount,
        revealScript: commitResult.revealScript,
        recipientAddress: testTaprootAddress,
        feeRate: 10,
        network: "mainnet",
      });

      expect(revealResult.tx).toBeInstanceOf(btc.Transaction);
    });

    it("should throw for invalid commit txid (too short)", () => {
      const commitResult = buildTestCommit();

      expect(() =>
        buildRevealTransaction({
          commitTxid: "tooshort",
          commitVout: 0,
          commitAmount: commitResult.revealAmount,
          revealScript: commitResult.revealScript,
          recipientAddress: testTaprootAddress,
          feeRate: 10,
          network: "mainnet",
        })
      ).toThrow("Invalid commit transaction ID");
    });

    it("should throw for negative fee rate", () => {
      const commitResult = buildTestCommit();

      expect(() =>
        buildRevealTransaction({
          commitTxid: "d".repeat(64),
          commitVout: 0,
          commitAmount: commitResult.revealAmount,
          revealScript: commitResult.revealScript,
          recipientAddress: testTaprootAddress,
          feeRate: -5,
          network: "mainnet",
        })
      ).toThrow("Fee rate must be positive");
    });

    it("should throw when commit amount is too small to cover fee and dust", () => {
      const commitResult = buildTestCommit();

      // A very small commit amount that can't cover the fee + dust
      expect(() =>
        buildRevealTransaction({
          commitTxid: "e".repeat(64),
          commitVout: 0,
          commitAmount: 600,
          revealScript: commitResult.revealScript,
          recipientAddress: testTaprootAddress,
          feeRate: 10,
          network: "mainnet",
        })
      ).toThrow("dust threshold");
    });
  });

  describe("buildCommitTransaction", () => {
    it("should return revealScript with tapLeafScript for use in reveal transaction", () => {
      const mockUtxo = createMockUtxo(
        "0000000000000000000000000000000000000000000000000000000000000001",
        0,
        500000
      );

      const result = buildCommitTransaction({
        utxos: [mockUtxo],
        inscription: TEST_INSCRIPTION,
        feeRate: 10,
        senderPubKey: testPubKey,
        senderAddress: testKeyPair.address,
        network: "mainnet",
      });

      // The revealScript must have tapLeafScript set for the reveal tx to sign correctly
      expect(result.revealScript.tapLeafScript).toBeDefined();
      expect(Array.isArray(result.revealScript.tapLeafScript)).toBe(true);
      expect(result.revealScript.tapLeafScript!.length).toBeGreaterThan(0);
    });

    it("should return a valid reveal address starting with bc1p", () => {
      const mockUtxo = createMockUtxo(
        "0000000000000000000000000000000000000000000000000000000000000001",
        0,
        500000
      );

      const result = buildCommitTransaction({
        utxos: [mockUtxo],
        inscription: TEST_INSCRIPTION,
        feeRate: 10,
        senderPubKey: testPubKey,
        senderAddress: testKeyPair.address,
        network: "mainnet",
      });

      expect(result.revealAddress).toMatch(/^bc1p/);
    });

    it("should return a Transaction instance for the commit tx", () => {
      const mockUtxo = createMockUtxo(
        "0000000000000000000000000000000000000000000000000000000000000001",
        0,
        500000
      );

      const result = buildCommitTransaction({
        utxos: [mockUtxo],
        inscription: TEST_INSCRIPTION,
        feeRate: 10,
        senderPubKey: testPubKey,
        senderAddress: testKeyPair.address,
        network: "mainnet",
      });

      expect(result.tx).toBeInstanceOf(btc.Transaction);
      expect(result.fee).toBeGreaterThan(0);
      expect(result.revealAmount).toBeGreaterThan(0);
    });

    it("should throw for empty UTXOs", () => {
      expect(() =>
        buildCommitTransaction({
          utxos: [],
          inscription: TEST_INSCRIPTION,
          feeRate: 10,
          senderPubKey: testPubKey,
          senderAddress: testKeyPair.address,
          network: "mainnet",
        })
      ).toThrow("No UTXOs provided");
    });

    it("should throw for invalid pubkey length (not 33 bytes)", () => {
      const mockUtxo = createMockUtxo(
        "0000000000000000000000000000000000000000000000000000000000000001",
        0,
        500000
      );

      const shortKey = new Uint8Array(16);

      expect(() =>
        buildCommitTransaction({
          utxos: [mockUtxo],
          inscription: TEST_INSCRIPTION,
          feeRate: 10,
          senderPubKey: shortKey,
          senderAddress: testKeyPair.address,
          network: "mainnet",
        })
      ).toThrow("Sender public key must be 33 bytes");
    });

    it("should throw for no confirmed UTXOs", () => {
      const unconfirmedUtxo = createMockUtxo(
        "0000000000000000000000000000000000000000000000000000000000000001",
        0,
        500000,
        false // unconfirmed
      );

      expect(() =>
        buildCommitTransaction({
          utxos: [unconfirmedUtxo],
          inscription: TEST_INSCRIPTION,
          feeRate: 10,
          senderPubKey: testPubKey,
          senderAddress: testKeyPair.address,
          network: "mainnet",
        })
      ).toThrow("No confirmed UTXOs available");
    });
  });

  describe("commit-reveal round trip", () => {
    it("should complete the full commit-reveal flow with signing and finalization", () => {
      // Step 1: Build commit transaction
      const mockUtxo = createMockUtxo(
        "0000000000000000000000000000000000000000000000000000000000000001",
        0,
        500000
      );

      const commitResult = buildCommitTransaction({
        utxos: [mockUtxo],
        inscription: TEST_INSCRIPTION,
        feeRate: 10,
        senderPubKey: testPubKey,
        senderAddress: testKeyPair.address,
        network: "mainnet",
      });

      // Reveal address must be a valid P2TR address
      expect(commitResult.revealAddress).toMatch(/^bc1p/);
      expect(commitResult.revealAmount).toBeGreaterThan(0);
      expect(commitResult.fee).toBeGreaterThan(0);

      // Step 2: Sign and finalize commit transaction
      commitResult.tx.sign(testKeyPair.privateKey);
      expect(() => commitResult.tx.finalize()).not.toThrow();

      // Step 3: Build reveal transaction using reveal script from commit
      const fakeCommitTxid = "f".repeat(64);
      const revealResult = buildRevealTransaction({
        commitTxid: fakeCommitTxid,
        commitVout: 0,
        commitAmount: commitResult.revealAmount,
        revealScript: commitResult.revealScript,
        recipientAddress: testTaprootAddress,
        feeRate: 10,
        network: "mainnet",
      });

      expect(revealResult.outputAmount).toBeGreaterThan(0);
      expect(revealResult.fee).toBeGreaterThan(0);

      // Step 4: Sign and finalize reveal transaction
      // This is the key test — tapLeafScript must be correctly set for signing to work
      revealResult.tx.sign(testKeyPair.privateKey);
      expect(() => revealResult.tx.finalize()).not.toThrow();
    });

    it("should derive the same reveal address in commit and standalone deriveRevealScript", () => {
      // Verify that buildCommitTransaction and deriveRevealScript produce the same reveal address
      // This confirms the inscription tool can call deriveRevealScript independently
      const mockUtxo = createMockUtxo(
        "0000000000000000000000000000000000000000000000000000000000000002",
        0,
        500000
      );

      const commitResult = buildCommitTransaction({
        utxos: [mockUtxo],
        inscription: TEST_INSCRIPTION,
        feeRate: 10,
        senderPubKey: testPubKey,
        senderAddress: testKeyPair.address,
        network: "mainnet",
      });

      const standaloneScript = deriveRevealScript({
        inscription: TEST_INSCRIPTION,
        senderPubKey: testPubKey,
        network: "mainnet",
      });

      // Both must produce the same reveal address (deterministic)
      expect(commitResult.revealAddress).toBe(standaloneScript.address);
    });
  });
});
