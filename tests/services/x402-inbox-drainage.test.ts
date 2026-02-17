import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// Mocks — must be declared before importing the module under test
// ============================================================================

const mockGetBalance = vi.fn();
const mockGetStxBalance = vi.fn();
const mockGetMempoolFees = vi.fn();
const mockGetActiveAccount = vi.fn();

vi.mock("../../src/services/sbtc.service.js", () => ({
  getSbtcService: () => ({ getBalance: mockGetBalance }),
}));

vi.mock("../../src/services/hiro-api.js", () => ({
  getHiroApi: () => ({
    getStxBalance: mockGetStxBalance,
    getMempoolFees: mockGetMempoolFees,
  }),
}));

vi.mock("../../src/services/wallet-manager.js", () => ({
  getWalletManager: () => ({
    getActiveAccount: mockGetActiveAccount,
  }),
}));

// Mock x402-stacks to avoid real crypto operations in tests
vi.mock("x402-stacks", () => ({
  wrapAxiosWithPayment: (instance: import("axios").AxiosInstance) => instance,
  decodePaymentRequired: () => null,
  X402_HEADERS: { PAYMENT_REQUIRED: "x-payment-required" },
}));

// Import after mocks are established
const {
  checkSufficientBalance,
  generateDedupKey,
  checkDedupCache,
  recordTransaction,
  createApiClient,
  probeEndpoint,
} = await import("../../src/services/x402.service.js");

// ============================================================================
// Helpers
// ============================================================================

const MOCK_ACCOUNT = {
  address: "SP000000000000000000002Q6VF78",
  privateKey: "0".repeat(64),
  network: "mainnet" as const,
};

const standardFees = {
  all: { no_priority: 0, low_priority: 1000, medium_priority: 5000, high_priority: 10000 },
  token_transfer: { no_priority: 0, low_priority: 500, medium_priority: 2500, high_priority: 5000 },
  contract_call: { no_priority: 0, low_priority: 2000, medium_priority: 8000, high_priority: 15000 },
  smart_contract: { no_priority: 0, low_priority: 5000, medium_priority: 20000, high_priority: 50000 },
};

const INBOX_RECIPIENT = "SP1234ABCD5678EF90RECIPIENT";
const INBOX_URL = `https://aibtc.com/api/inbox/${INBOX_RECIPIENT}`;
const INBOX_DATA = { from: "SP000000000000000000002Q6VF78", message: "hello" };

// ============================================================================
// Tests: Drainage Bug — dedup gap when payment fails after broadcast
// ============================================================================

describe("x402 inbox drainage bug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveAccount.mockReturnValue(MOCK_ACCOUNT);
    mockGetMempoolFees.mockResolvedValue(standardFees);
  });

  describe("dedup gap: payment failure leaves no dedup record", () => {
    it("dedup key is NOT recorded when api.request() throws after payment", async () => {
      // Simulate the exact flow from endpoint.tools.ts lines 320-346:
      //   1. Generate dedup key
      //   2. Check dedup cache → miss
      //   3. Create payment client → make request → THROWS (server returned 402 after settlement)
      //   4. recordTransaction() is NEVER called
      //   5. Next call: dedup cache → miss again → pays AGAIN

      const dedupKey = generateDedupKey("POST", INBOX_URL, undefined, INBOX_DATA);

      // First attempt: no dedup hit (as expected)
      expect(checkDedupCache(dedupKey)).toBeNull();

      // Simulate: payment was made but request threw an error
      // (In real code, api.request() throws because server returned 402 after settlement)
      // recordTransaction() is NEVER called because it's after the throwing line

      // Second attempt: dedup cache is STILL empty — this is the bug
      expect(checkDedupCache(dedupKey)).toBeNull();
      // If dedup was properly recorded before the request, this would return a txid
    });

    it("dedup SHOULD be recorded before making the payment request (proposed fix)", () => {
      // The fix: record a pending entry BEFORE making the payment request
      const dedupKey = generateDedupKey("POST", INBOX_URL, undefined, INBOX_DATA);

      // Record with a "pending" txid before the request
      recordTransaction(dedupKey, "pending");

      // Even if the request throws, the dedup cache now has an entry
      expect(checkDedupCache(dedupKey)).toBe("pending");

      // A retry within 60s would be caught
      const retryDedupKey = generateDedupKey("POST", INBOX_URL, undefined, INBOX_DATA);
      expect(checkDedupCache(retryDedupKey)).toBe("pending");
    });
  });

  describe("server returns 402 after payment settlement (simulated)", () => {
    it("payment client throws when server returns 402 on retry (guard catches it)", async () => {
      const client = await createApiClient("https://aibtc.com");

      // Simulate: server ALWAYS returns 402 (even after receiving X-PAYMENT header)
      // This mimics the landing-page bug where verifyInboxPayment fails
      // but the payment was already broadcast on-chain
      client.defaults.adapter = async (config) => {
        throw {
          response: {
            status: 402,
            data: {
              maxAmountRequired: "100",
              resource: INBOX_URL,
              payTo: INBOX_RECIPIENT,
              network: "mainnet",
              nonce: "test-nonce-123",
              expiresAt: new Date(Date.now() + 300000).toISOString(),
              tokenType: "sBTC",
              tokenContract: {
                address: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
                name: "sbtc-token",
              },
            },
            headers: {},
            config,
          },
          config,
        };
      };

      // First call: guard allows (count 0 → 1), passes 402 through
      // Since x402-stacks is mocked (passthrough), the 402 becomes an unhandled rejection
      // Second call on same client: guard blocks (count >= 1)
      //
      // Verify: first call throws (402 not handled since interceptor is mocked)
      await expect(client.post(`/api/inbox/${INBOX_RECIPIENT}`, INBOX_DATA))
        .rejects.toBeDefined();

      // Verify: second call on SAME client is blocked by guard
      await expect(client.post(`/api/inbox/${INBOX_RECIPIENT}`, INBOX_DATA))
        .rejects.toThrow("Payment retry limit exceeded");
    });

    it("NEW client instance bypasses guard (drainage across retries)", async () => {
      // This demonstrates the actual drainage scenario:
      // Each execute_x402_endpoint call creates a FRESH client
      // If the first call fails, the agent retries with a new call
      // The new call creates a new client with a fresh attempt counter

      const client1 = await createApiClient("https://aibtc.com");
      const client2 = await createApiClient("https://aibtc.com");

      // They are different instances with independent attempt counters
      expect(client1).not.toBe(client2);

      // Both would allow 1 payment attempt each
      // Without dedup protection, each call = 1 payment = drainage
    });
  });

  describe("dedup key stability for inbox messages", () => {
    it("identical messages produce the same dedup key", () => {
      const key1 = generateDedupKey("POST", INBOX_URL, undefined, INBOX_DATA);
      const key2 = generateDedupKey("POST", INBOX_URL, undefined, INBOX_DATA);
      expect(key1).toBe(key2);
    });

    it("different message content produces different dedup keys (expected)", () => {
      const key1 = generateDedupKey("POST", INBOX_URL, undefined, { from: "SP1", message: "hello" });
      const key2 = generateDedupKey("POST", INBOX_URL, undefined, { from: "SP1", message: "Hello" });
      expect(key1).not.toBe(key2);
    });

    it("different recipients produce different dedup keys", () => {
      const url1 = "https://aibtc.com/api/inbox/SP_ALICE";
      const url2 = "https://aibtc.com/api/inbox/SP_BOB";
      const key1 = generateDedupKey("POST", url1, undefined, INBOX_DATA);
      const key2 = generateDedupKey("POST", url2, undefined, INBOX_DATA);
      expect(key1).not.toBe(key2);
    });
  });

  describe("sBTC balance check for inbox payment", () => {
    it("inbox message costs 100 sats (0.000001 sBTC) — validates balance correctly", async () => {
      // Inbox costs 100 sats sBTC
      mockGetBalance.mockResolvedValue({ balance: "200" }); // 200 sats available
      mockGetStxBalance.mockResolvedValue({ balance: "100000" }); // STX for gas

      await expect(
        checkSufficientBalance(MOCK_ACCOUNT, "100", "sbtc")
      ).resolves.toBeUndefined();
    });

    it("rejects when sBTC balance insufficient for inbox message", async () => {
      mockGetBalance.mockResolvedValue({ balance: "50" }); // Only 50 sats, need 100

      await expect(
        checkSufficientBalance(MOCK_ACCOUNT, "100", "sbtc")
      ).rejects.toThrow("Insufficient sBTC balance");
    });
  });
});

// ============================================================================
// Tests: Proposed fix validation
// ============================================================================

describe("proposed fix: pre-record dedup before payment request", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pre-recorded dedup prevents retry within 60s window", () => {
    const dedupKey = generateDedupKey("POST", INBOX_URL, undefined, INBOX_DATA);

    // Step 1: Record BEFORE making payment request (proposed fix)
    recordTransaction(dedupKey, "pending");

    // Step 2: Payment request throws (server returned 402 after settlement)
    // ... error happens ...

    // Step 3: Agent retries — dedup cache catches it
    const retryResult = checkDedupCache(dedupKey);
    expect(retryResult).toBe("pending");
    // The retry would see this and return early without paying again
  });

  it("pre-recorded dedup can be updated with real txid on success", () => {
    const dedupKey = generateDedupKey("POST", INBOX_URL, undefined, INBOX_DATA);

    // Pre-record
    recordTransaction(dedupKey, "pending");

    // Payment succeeds — update with real txid
    recordTransaction(dedupKey, "0xabc123def456");

    expect(checkDedupCache(dedupKey)).toBe("0xabc123def456");
  });

  it("pre-recorded dedup expires after 60s (allows intentional retries)", () => {
    const dedupKey = generateDedupKey("POST", INBOX_URL, undefined, INBOX_DATA);

    recordTransaction(dedupKey, "pending");

    // After 61 seconds, the entry expires
    vi.advanceTimersByTime(61_000);
    expect(checkDedupCache(dedupKey)).toBeNull();
  });
});
