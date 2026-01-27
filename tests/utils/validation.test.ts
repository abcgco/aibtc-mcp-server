import { describe, it, expect } from "vitest";
import {
  isValidStacksAddress,
  isValidContractId,
  isValidTxId,
} from "../../src/utils/validation.js";

describe("validation", () => {
  describe("isValidStacksAddress", () => {
    it("should accept valid mainnet address with SP prefix", () => {
      expect(
        isValidStacksAddress("SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9")
      ).toBe(true);
    });

    it("should accept valid mainnet address with SM prefix", () => {
      expect(
        isValidStacksAddress("SM2MARAVW6BEJCD13YV2RHGYHQWT7TDDNMNRB1MVT")
      ).toBe(true);
    });

    it("should accept testnet address with ST prefix", () => {
      expect(
        isValidStacksAddress("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM")
      ).toBe(true);
    });

    it("should reject empty string", () => {
      expect(isValidStacksAddress("")).toBe(false);
    });

    it("should reject lowercase address", () => {
      expect(
        isValidStacksAddress("sp2pabaf9ftajynfzh93xenaj8fvy99rrm50d2jg9")
      ).toBe(false);
    });

    it("should reject address that is too short", () => {
      expect(isValidStacksAddress("SP123")).toBe(false);
    });

    it("should reject address with wrong prefix", () => {
      expect(
        isValidStacksAddress("XX2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9")
      ).toBe(false);
    });

    it("should reject address with invalid characters", () => {
      expect(
        isValidStacksAddress("SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG!")
      ).toBe(false);
    });
  });

  describe("isValidContractId", () => {
    it("should accept valid contract ID", () => {
      expect(
        isValidContractId(
          "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait"
        )
      ).toBe(true);
    });

    it("should accept contract name with hyphens", () => {
      expect(
        isValidContractId(
          "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.token-alex"
        )
      ).toBe(true);
    });

    it("should accept contract name with numbers", () => {
      expect(
        isValidContractId(
          "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.pool-v2-3"
        )
      ).toBe(true);
    });

    it("should reject missing dot separator", () => {
      expect(
        isValidContractId("SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9nft-trait")
      ).toBe(false);
    });

    it("should reject contract name starting with number", () => {
      expect(
        isValidContractId(
          "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.1token"
        )
      ).toBe(false);
    });

    it("should reject invalid contract name characters", () => {
      expect(
        isValidContractId(
          "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.token@invalid"
        )
      ).toBe(false);
    });

    it("should reject empty string", () => {
      expect(isValidContractId("")).toBe(false);
    });

    it("should reject invalid address portion", () => {
      expect(isValidContractId("INVALID.token-name")).toBe(false);
    });
  });

  describe("isValidTxId", () => {
    it("should accept 64 hex chars without 0x prefix", () => {
      expect(
        isValidTxId(
          "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
        )
      ).toBe(true);
    });

    it("should accept 64 hex chars with 0x prefix", () => {
      expect(
        isValidTxId(
          "0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
        )
      ).toBe(true);
    });

    it("should accept uppercase hex chars", () => {
      expect(
        isValidTxId(
          "A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1B2"
        )
      ).toBe(true);
    });

    it("should accept mixed case hex chars", () => {
      expect(
        isValidTxId(
          "A1b2C3d4E5f6A7b8C9d0E1f2A3b4C5d6E7f8A9b0C1d2E3f4A5b6C7d8E9f0A1b2"
        )
      ).toBe(true);
    });

    it("should reject txid that is too short", () => {
      expect(isValidTxId("a1b2c3d4e5f6")).toBe(false);
    });

    it("should reject txid that is too long", () => {
      expect(
        isValidTxId(
          "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3"
        )
      ).toBe(false);
    });

    it("should reject non-hex characters", () => {
      expect(
        isValidTxId(
          "z1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
        )
      ).toBe(false);
    });

    it("should reject empty string", () => {
      expect(isValidTxId("")).toBe(false);
    });
  });
});
