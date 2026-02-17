/**
 * Live test script: Send an inbox message from "secret mars" to "tiny marten" on aibtc.com.
 *
 * Agent addresses (from https://aibtc.com/api/agents):
 *   - Secret Mars:  STX SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE
 *   - Tiny Marten:  STX SPKH9AWG0ENZ87J1X0PBD4HETP22G8W22AFNVF8K
 *                   BTC bc1qyu22hyqr406pus0g9jmfytk4ss5z8qsje74l76
 *
 * Prerequisites:
 *   1. The "secret mars name" managed wallet must exist locally
 *   2. The wallet must have sBTC (≥100 sats) and STX for gas
 *   3. Set TEST_WALLET_PASSWORD env var to the wallet password
 *
 * Usage:
 *   TEST_WALLET_PASSWORD=<password> npx tsx tests/scripts/test-inbox-send.ts
 */

import { getWalletManager } from "../../src/services/wallet-manager.js";
import {
  probeEndpoint,
  getAccount,
  getWalletAddress,
  checkSufficientBalance,
  generateDedupKey,
  checkDedupCache,
  recordTransaction,
  createPlainClient,
  createApiClient,
  formatPaymentAmount,
} from "../../src/services/x402.service.js";

const TINY_MARTEN_STX = "SPKH9AWG0ENZ87J1X0PBD4HETP22G8W22AFNVF8K";
const TINY_MARTEN_BTC = "bc1qyu22hyqr406pus0g9jmfytk4ss5z8qsje74l76";

const WALLET_NAME = "secret mars name";
const WALLET_PASSWORD = process.env.TEST_WALLET_PASSWORD || "";
const AIBTC_BASE_URL = "https://aibtc.com";

async function main() {
  if (!WALLET_PASSWORD) {
    console.error("Set TEST_WALLET_PASSWORD env var");
    process.exit(1);
  }

  // 1. Unlock wallet
  console.log("\n[1] Unlocking wallet...");
  const wm = getWalletManager();
  const wallets = await wm.listWallets();
  const target = wallets.find((w) => w.name === WALLET_NAME);
  if (!target) {
    console.error("Wallet not found. Available:", wallets.map((w) => w.name));
    process.exit(1);
  }
  await wm.unlock(target.id, WALLET_PASSWORD);
  console.log("  address:", await getWalletAddress());

  // 2. Probe
  const endpointUrl = `${AIBTC_BASE_URL}/api/inbox/${TINY_MARTEN_STX}`;
  const requestBody = {
    toBtcAddress: TINY_MARTEN_BTC,
    toStxAddress: TINY_MARTEN_STX,
    content: `Test from secret mars at ${new Date().toISOString()}`,
  };
  console.log("\n[2] Probing...");
  const probe = await probeEndpoint({ method: "POST", url: endpointUrl, data: requestBody });
  console.log(JSON.stringify(probe, null, 2));

  if (probe.type !== "payment_required") {
    console.log("  Free endpoint, sending...");
    const r = await createPlainClient(AIBTC_BASE_URL).post(`/api/inbox/${TINY_MARTEN_STX}`, requestBody);
    console.log(JSON.stringify(r.data, null, 2));
    return;
  }

  // 3. Balance check
  console.log("\n[3] Balance check...");
  const account = await getAccount();
  await checkSufficientBalance(account, probe.amount, probe.asset);
  console.log("  OK");

  // 4. Dedup
  console.log("\n[4] Dedup check...");
  const dedupKey = generateDedupKey("POST", endpointUrl, undefined, requestBody);
  const existing = checkDedupCache(dedupKey);
  if (existing) {
    console.log("  Blocked:", existing);
    return;
  }
  recordTransaction(dedupKey, "pending");
  console.log("  Pre-recorded");

  // 5. Send with logger → guard → x402 interceptor (correct order)
  console.log("\n[5] Sending...");
  const { default: axios } = await import("axios");
  const { wrapAxiosWithPayment } = await import("x402-stacks");

  const raw = axios.create({ baseURL: AIBTC_BASE_URL, timeout: 120000 });
  let attempts = 0;

  // 1st: Logger — captures every raw 402
  raw.interceptors.response.use(undefined, (e) => {
    if (e?.response) {
      console.log(`  [raw ${e.response.status}] data:`, JSON.stringify(e.response.data, null, 2));
    }
    return Promise.reject(e);
  });

  // 2nd: Guard — blocks after 1 payment attempt
  raw.interceptors.response.use(undefined, (e) => {
    if (e?.response?.status !== 402) return Promise.reject(e);
    attempts++;
    if (attempts > 1) return Promise.reject(new Error("Guard: payment retry blocked"));
    return Promise.reject(e);
  });

  // 3rd: x402 v2 interceptor — signs and retries
  const api = wrapAxiosWithPayment(raw, account);

  const response = await api.post(`/api/inbox/${TINY_MARTEN_STX}`, requestBody);
  console.log("status:", response.status);
  console.log("data:", JSON.stringify(response.data, null, 2));

  const txid = (response.data as Record<string, unknown>)?.txid || response.headers?.["x-transaction-id"] || "paid";
  recordTransaction(dedupKey, String(txid));

  // 6. Verify
  console.log("\n[6] Reading inbox...");
  const inbox = await createPlainClient(AIBTC_BASE_URL).get(`/api/inbox/${TINY_MARTEN_STX}`);
  console.log("status:", inbox.status);
  console.log("data:", JSON.stringify(inbox.data, null, 2));
}

main().catch((err) => {
  const axErr = err as { response?: { status?: number; data?: unknown; headers?: unknown }; message?: string };
  console.error("\nERROR:", axErr.message);
  if (axErr.response) {
    console.error("status:", axErr.response.status);
    console.error("headers:", JSON.stringify(axErr.response.headers, null, 2));
    console.error("data:", JSON.stringify(axErr.response.data, null, 2));
  }
  process.exit(1);
});
