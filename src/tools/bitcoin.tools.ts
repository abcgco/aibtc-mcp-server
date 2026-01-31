/**
 * Bitcoin L1 read-only tools
 *
 * These tools provide read-only access to Bitcoin blockchain data:
 * - get_btc_balance: Check BTC balance for an address
 * - get_btc_fees: Get current fee estimates
 * - get_btc_utxos: List UTXOs for an address
 *
 * All data is fetched from mempool.space API (no authentication required).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NETWORK } from "../config/networks.js";
import { createJsonResponse, createErrorResponse } from "../utils/index.js";
import { getWalletManager } from "../services/wallet-manager.js";
import {
  MempoolApi,
  getMempoolAddressUrl,
  type UTXO,
} from "../services/mempool-api.js";

/**
 * Get the Bitcoin address to use for queries.
 * Prefers the provided address, falls back to wallet's btcAddress.
 */
async function getBtcAddress(providedAddress?: string): Promise<string> {
  if (providedAddress) {
    return providedAddress;
  }

  const walletManager = getWalletManager();
  const sessionInfo = walletManager.getSessionInfo();

  if (sessionInfo?.btcAddress) {
    return sessionInfo.btcAddress;
  }

  throw new Error(
    "No Bitcoin address provided and wallet is not unlocked. " +
      "Either provide an address or unlock your wallet first."
  );
}

/**
 * Format satoshis as BTC string
 */
function formatBtc(satoshis: number): string {
  const btc = satoshis / 100_000_000;
  return btc.toFixed(8).replace(/\.?0+$/, "") + " BTC";
}

export function registerBitcoinTools(server: McpServer): void {
  // Get BTC balance
  server.registerTool(
    "get_btc_balance",
    {
      description:
        "Get the BTC balance for a Bitcoin address. " +
        "Returns both total balance (including unconfirmed) and confirmed balance.",
      inputSchema: {
        address: z
          .string()
          .optional()
          .describe(
            "Bitcoin address to check (bc1... for mainnet, tb1... for testnet). " +
              "Uses wallet's Bitcoin address if not provided."
          ),
      },
    },
    async ({ address }) => {
      try {
        const btcAddress = await getBtcAddress(address);
        const api = new MempoolApi(NETWORK);
        const utxos = await api.getUtxos(btcAddress);

        // Calculate total and confirmed balances
        let totalSatoshis = 0;
        let confirmedSatoshis = 0;

        for (const utxo of utxos) {
          totalSatoshis += utxo.value;
          if (utxo.status.confirmed) {
            confirmedSatoshis += utxo.value;
          }
        }

        const unconfirmedSatoshis = totalSatoshis - confirmedSatoshis;

        return createJsonResponse({
          address: btcAddress,
          network: NETWORK,
          balance: {
            satoshis: totalSatoshis,
            btc: formatBtc(totalSatoshis),
          },
          confirmed: {
            satoshis: confirmedSatoshis,
            btc: formatBtc(confirmedSatoshis),
          },
          unconfirmed: {
            satoshis: unconfirmedSatoshis,
            btc: formatBtc(unconfirmedSatoshis),
          },
          utxoCount: utxos.length,
          explorerUrl: getMempoolAddressUrl(btcAddress, NETWORK),
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );

  // Get BTC fee estimates
  server.registerTool(
    "get_btc_fees",
    {
      description:
        "Get current Bitcoin fee estimates for different confirmation targets. " +
        "Returns fast (~10 min), medium (~30 min), and slow (~1 hour) fee rates in sat/vB.",
    },
    async () => {
      try {
        const api = new MempoolApi(NETWORK);
        const tiers = await api.getFeeTiers();
        const fullEstimates = await api.getFeeEstimates();

        return createJsonResponse({
          network: NETWORK,
          fees: {
            fast: {
              satPerVb: tiers.fast,
              target: "~10 minutes (next block)",
            },
            medium: {
              satPerVb: tiers.medium,
              target: "~30 minutes",
            },
            slow: {
              satPerVb: tiers.slow,
              target: "~1 hour",
            },
          },
          economy: {
            satPerVb: fullEstimates.economyFee,
            target: "~24 hours",
          },
          minimum: {
            satPerVb: fullEstimates.minimumFee,
            target: "minimum relay fee",
          },
          unit: "sat/vB",
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );

  // Get BTC UTXOs
  server.registerTool(
    "get_btc_utxos",
    {
      description:
        "List all UTXOs (Unspent Transaction Outputs) for a Bitcoin address. " +
        "Useful for debugging, transparency, and understanding transaction inputs.",
      inputSchema: {
        address: z
          .string()
          .optional()
          .describe(
            "Bitcoin address to check. Uses wallet's Bitcoin address if not provided."
          ),
        confirmedOnly: z
          .boolean()
          .optional()
          .default(false)
          .describe("Only return confirmed UTXOs (default: false)"),
      },
    },
    async ({ address, confirmedOnly }) => {
      try {
        const btcAddress = await getBtcAddress(address);
        const api = new MempoolApi(NETWORK);
        let utxos = await api.getUtxos(btcAddress);

        // Filter to confirmed only if requested
        if (confirmedOnly) {
          utxos = utxos.filter((u) => u.status.confirmed);
        }

        // Calculate total value
        const totalValue = utxos.reduce((sum, u) => sum + u.value, 0);

        // Format UTXOs for response
        const formattedUtxos = utxos.map((u: UTXO) => ({
          txid: u.txid,
          vout: u.vout,
          value: {
            satoshis: u.value,
            btc: formatBtc(u.value),
          },
          confirmed: u.status.confirmed,
          blockHeight: u.status.block_height,
          blockTime: u.status.block_time
            ? new Date(u.status.block_time * 1000).toISOString()
            : undefined,
        }));

        return createJsonResponse({
          address: btcAddress,
          network: NETWORK,
          utxos: formattedUtxos,
          summary: {
            count: utxos.length,
            totalValue: {
              satoshis: totalValue,
              btc: formatBtc(totalValue),
            },
            confirmedCount: utxos.filter((u) => u.status.confirmed).length,
            unconfirmedCount: utxos.filter((u) => !u.status.confirmed).length,
          },
          explorerUrl: getMempoolAddressUrl(btcAddress, NETWORK),
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );
}
