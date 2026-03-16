import { describe, it, expect } from "vitest";
import {
  MAINNET_CONTRACTS,
  TESTNET_CONTRACTS,
  WELL_KNOWN_TOKENS,
  getContracts,
  parseContractId,
} from "../../src/config/contracts.js";

// Clarinet devnet deployer — used in local sandboxes, never on a real network.
// Regression marker for issue #309: testnet contracts must NOT use this address.
const DEVNET_DEPLOYER = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";

describe("contracts", () => {
  describe("MAINNET_CONTRACTS", () => {
    it("SBTC_TOKEN is the canonical mainnet address", () => {
      expect(MAINNET_CONTRACTS.SBTC_TOKEN).toBe(
        "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token"
      );
    });

    it("all sBTC contracts use SM deployer prefix (mainnet)", () => {
      const sbtcContracts = [
        MAINNET_CONTRACTS.SBTC_TOKEN,
        MAINNET_CONTRACTS.SBTC_DEPOSIT,
        MAINNET_CONTRACTS.SBTC_REGISTRY,
        MAINNET_CONTRACTS.SBTC_WITHDRAWAL,
      ];
      for (const contract of sbtcContracts) {
        expect(contract, `${contract} should start with SM`).toMatch(/^SM/);
      }
    });

    it("all mainnet sBTC contracts share the same deployer address", () => {
      const deployer = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
      expect(MAINNET_CONTRACTS.SBTC_TOKEN).toContain(deployer);
      expect(MAINNET_CONTRACTS.SBTC_DEPOSIT).toContain(deployer);
      expect(MAINNET_CONTRACTS.SBTC_REGISTRY).toContain(deployer);
      expect(MAINNET_CONTRACTS.SBTC_WITHDRAWAL).toContain(deployer);
    });

    it("all contract IDs contain exactly one dot separator", () => {
      for (const [key, value] of Object.entries(MAINNET_CONTRACTS)) {
        const parts = value.split(".");
        expect(parts.length, `${key} should have address.name format`).toBe(2);
        expect(parts[0].length, `${key} address part should not be empty`).toBeGreaterThan(0);
        expect(parts[1].length, `${key} name part should not be empty`).toBeGreaterThan(0);
      }
    });
  });

  describe("TESTNET_CONTRACTS", () => {
    // Regression test for issue #309:
    // Clarinet devnet deployer was incorrectly used as the testnet sBTC deployer.
    // These tests fail on the buggy code and pass after the fix in PR #310.
    it("SBTC_TOKEN does not use the Clarinet devnet deployer (regression #309)", () => {
      expect(TESTNET_CONTRACTS.SBTC_TOKEN).not.toContain(DEVNET_DEPLOYER);
    });

    it("all testnet sBTC contracts do not use the Clarinet devnet deployer (regression #309)", () => {
      const sbtcContracts = [
        TESTNET_CONTRACTS.SBTC_TOKEN,
        TESTNET_CONTRACTS.SBTC_DEPOSIT,
        TESTNET_CONTRACTS.SBTC_REGISTRY,
        TESTNET_CONTRACTS.SBTC_WITHDRAWAL,
      ];
      for (const contract of sbtcContracts) {
        expect(
          contract,
          `${contract} must not use devnet deployer ${DEVNET_DEPLOYER}`
        ).not.toContain(DEVNET_DEPLOYER);
      }
    });

    it("testnet sBTC contracts use ST deployer prefix", () => {
      const sbtcContracts = [
        TESTNET_CONTRACTS.SBTC_TOKEN,
        TESTNET_CONTRACTS.SBTC_DEPOSIT,
        TESTNET_CONTRACTS.SBTC_REGISTRY,
        TESTNET_CONTRACTS.SBTC_WITHDRAWAL,
      ];
      for (const contract of sbtcContracts) {
        expect(contract, `${contract} should start with ST`).toMatch(/^ST/);
      }
    });

    it("testnet and mainnet SBTC_TOKEN are different addresses", () => {
      expect(TESTNET_CONTRACTS.SBTC_TOKEN).not.toBe(MAINNET_CONTRACTS.SBTC_TOKEN);
    });

    it("all testnet contract IDs contain exactly one dot separator", () => {
      for (const [key, value] of Object.entries(TESTNET_CONTRACTS)) {
        const parts = value.split(".");
        expect(parts.length, `${key} should have address.name format`).toBe(2);
      }
    });
  });

  describe("getContracts()", () => {
    it("returns mainnet contracts for 'mainnet'", () => {
      expect(getContracts("mainnet")).toBe(MAINNET_CONTRACTS);
    });

    it("returns testnet contracts for 'testnet'", () => {
      expect(getContracts("testnet")).toBe(TESTNET_CONTRACTS);
    });
  });

  describe("WELL_KNOWN_TOKENS", () => {
    it("testnet sBTC token mirrors TESTNET_CONTRACTS.SBTC_TOKEN", () => {
      expect(WELL_KNOWN_TOKENS.testnet.sBTC).toBe(TESTNET_CONTRACTS.SBTC_TOKEN);
    });

    it("mainnet sBTC token mirrors MAINNET_CONTRACTS.SBTC_TOKEN", () => {
      expect(WELL_KNOWN_TOKENS.mainnet.sBTC).toBe(MAINNET_CONTRACTS.SBTC_TOKEN);
    });
  });

  describe("parseContractId()", () => {
    it("splits address and name from a valid contract ID", () => {
      const { address, name } = parseContractId(
        "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token"
      );
      expect(address).toBe("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4");
      expect(name).toBe("sbtc-token");
    });

    it("handles hyphenated contract names", () => {
      const { address, name } = parseContractId(
        "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market"
      );
      expect(name).toBe("v0-4-market");
    });

    it("throws on a string with no dot", () => {
      expect(() => parseContractId("nodothere")).toThrow();
    });

    it("throws on a string with leading dot (empty address)", () => {
      expect(() => parseContractId(".contract-name")).toThrow();
    });
  });
});
