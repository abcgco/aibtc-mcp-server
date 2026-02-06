import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAccount, getWalletAddress, NETWORK } from "../services/x402.service.js";
import { getVelarService } from "../services/velar.service.js";
import { getExplorerTxUrl } from "../config/networks.js";
import { createJsonResponse, createErrorResponse, resolveFee } from "../utils/index.js";

export function registerVelarTools(server: McpServer): void {
  // Get trading pairs for a token
  server.registerTool(
    "velar_get_pairs",
    {
      description: `Get available trading pairs for a token on Velar DEX.

Velar is a DEX aggregator used by Xverse wallet.
Only available on mainnet.`,
      inputSchema: {
        symbol: z.string().describe("Token symbol (e.g., 'STX', 'sBTC', 'ALEX')"),
      },
    },
    async ({ symbol }) => {
      try {
        const velarService = getVelarService(NETWORK);
        const pairs = await velarService.getPairs(symbol);

        return createJsonResponse({
          token: symbol,
          pairs,
          pairCount: pairs.length,
          network: NETWORK,
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );

  // Get swap quote
  server.registerTool(
    "velar_get_quote",
    {
      description: `Get a swap quote from Velar DEX.

Returns expected output amount and route for the swap.
Only available on mainnet.`,
      inputSchema: {
        inToken: z.string().describe("Input token symbol (e.g., 'STX')"),
        outToken: z.string().describe("Output token symbol (e.g., 'sBTC')"),
        amount: z.string().describe("Amount to swap (in token's smallest unit)"),
        slippage: z
          .number()
          .optional()
          .default(0.5)
          .describe("Slippage tolerance in percent (default: 0.5)"),
      },
    },
    async ({ inToken, outToken, amount, slippage }) => {
      try {
        const velarService = getVelarService(NETWORK);
        const walletAddress = await getWalletAddress();

        const quote = await velarService.getQuote(
          walletAddress,
          inToken,
          outToken,
          parseFloat(amount),
          slippage
        );

        return createJsonResponse({
          ...quote,
          slippage: `${slippage}%`,
          network: NETWORK,
          valid: quote.valid,
          ...(quote.errorMessage && { error: quote.errorMessage }),
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );

  // Execute swap
  server.registerTool(
    "velar_swap",
    {
      description: `Execute a token swap on Velar DEX.

Swaps tokens using Velar's liquidity pools.
Only available on mainnet.`,
      inputSchema: {
        inToken: z.string().describe("Input token symbol (e.g., 'STX')"),
        outToken: z.string().describe("Output token symbol (e.g., 'sBTC')"),
        amount: z.string().describe("Amount to swap (in token's smallest unit)"),
        slippage: z
          .number()
          .optional()
          .default(0.5)
          .describe("Slippage tolerance in percent (default: 0.5)"),
        fee: z
          .string()
          .optional()
          .describe("Optional fee: 'low' | 'medium' | 'high' preset or micro-STX amount"),
      },
    },
    async ({ inToken, outToken, amount, slippage, fee }) => {
      try {
        const velarService = getVelarService(NETWORK);
        const account = await getAccount();
        const resolvedFee = await resolveFee(fee, NETWORK, "contract_call");

        // Get quote first to show expected output
        const quote = await velarService.getQuote(
          account.address,
          inToken,
          outToken,
          parseFloat(amount),
          slippage
        );

        if (!quote.valid) {
          return createErrorResponse(new Error(quote.errorMessage || "No route found"));
        }

        // Execute swap
        const result = await velarService.swap(
          account,
          inToken,
          outToken,
          parseFloat(amount),
          slippage,
          resolvedFee
        );

        return createJsonResponse({
          success: true,
          txid: result.txid,
          dex: "velar",
          swap: {
            from: inToken,
            to: outToken,
            amountIn: amount,
            expectedAmountOut: quote.amountOut,
            route: quote.route,
          },
          slippage: `${slippage}%`,
          network: NETWORK,
          explorerUrl: getExplorerTxUrl(result.txid, NETWORK),
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );
}
