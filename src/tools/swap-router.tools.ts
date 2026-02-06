import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAccount, getWalletAddress, NETWORK } from "../services/x402.service.js";
import { getSwapRouterService } from "../services/swap-router.service.js";
import { createJsonResponse, createErrorResponse, resolveFee } from "../utils/index.js";

export function registerSwapRouterTools(server: McpServer): void {
  // Compare quotes across DEXes
  server.registerTool(
    "swap_compare",
    {
      description: `Compare swap quotes across multiple DEXes (ALEX, Bitflow, Velar).

Returns quotes from all available DEXes and recommends the best rate.
Helps agents find optimal swap routes.
Only available on mainnet.

Example tokens: STX, sBTC, ALEX, VELAR, or contract IDs`,
      inputSchema: {
        tokenIn: z.string().describe("Input token symbol or contract ID"),
        tokenOut: z.string().describe("Output token symbol or contract ID"),
        amount: z.string().describe("Amount to swap (in token's smallest unit)"),
      },
    },
    async ({ tokenIn, tokenOut, amount }) => {
      try {
        const swapRouter = getSwapRouterService(NETWORK);
        let userAddress: string | undefined;

        try {
          userAddress = await getWalletAddress();
        } catch {
          // Wallet not configured, will use placeholder
        }

        const comparison = await swapRouter.compareQuotes(
          tokenIn,
          tokenOut,
          amount,
          userAddress
        );

        return createJsonResponse({
          network: NETWORK,
          tokenIn: comparison.tokenIn,
          tokenOut: comparison.tokenOut,
          amountIn: comparison.amountIn,
          quotes: comparison.quotes.map((q) => ({
            dex: q.dex,
            amountOut: q.amountOut,
            available: q.available,
            route: q.route,
            ...(q.priceImpact && { priceImpact: q.priceImpact }),
            ...(q.error && { error: q.error }),
          })),
          bestQuote: comparison.bestQuote
            ? {
                dex: comparison.bestQuote.dex,
                amountOut: comparison.bestQuote.amountOut,
                route: comparison.bestQuote.route,
              }
            : null,
          recommendation: comparison.recommendation,
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );

  // Execute swap through specific DEX
  server.registerTool(
    "swap_execute",
    {
      description: `Execute a swap through a specific DEX.

Use swap_compare first to find the best rate, then execute through chosen DEX.
Includes slippage protection via minAmountOut.
Only available on mainnet.`,
      inputSchema: {
        dex: z
          .enum(["alex", "bitflow", "velar"])
          .describe("DEX to use for the swap"),
        tokenIn: z.string().describe("Input token symbol or contract ID"),
        tokenOut: z.string().describe("Output token symbol or contract ID"),
        amount: z.string().describe("Amount to swap"),
        minAmountOut: z
          .string()
          .optional()
          .describe("Minimum output amount (slippage protection)"),
        slippage: z
          .number()
          .optional()
          .default(0.5)
          .describe("Slippage tolerance in percent (default: 0.5)"),
      },
    },
    async ({ dex, tokenIn, tokenOut, amount, minAmountOut, slippage }) => {
      try {
        const swapRouter = getSwapRouterService(NETWORK);
        const account = await getAccount();

        const result = await swapRouter.executeSwap(
          account,
          dex,
          tokenIn,
          tokenOut,
          amount,
          minAmountOut,
          slippage
        );

        return createJsonResponse({
          success: result.success,
          network: NETWORK,
          dex: result.dex,
          txid: result.txid,
          swap: {
            tokenIn: result.tokenIn,
            tokenOut: result.tokenOut,
            amountIn: result.amountIn,
            expectedAmountOut: result.expectedAmountOut,
          },
          slippage: `${slippage}%`,
          ...(minAmountOut && { minAmountOut }),
          explorerUrl: result.explorerUrl,
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );

  // Execute swap through best available DEX
  server.registerTool(
    "swap_best",
    {
      description: `Execute a swap through the DEX offering the best rate.

Automatically compares quotes from ALEX, Bitflow, and Velar,
then executes through the one with highest output.
Includes slippage protection.
Only available on mainnet.`,
      inputSchema: {
        tokenIn: z.string().describe("Input token symbol or contract ID"),
        tokenOut: z.string().describe("Output token symbol or contract ID"),
        amount: z.string().describe("Amount to swap"),
        minAmountOut: z
          .string()
          .optional()
          .describe("Minimum output amount (slippage protection)"),
        slippage: z
          .number()
          .optional()
          .default(0.5)
          .describe("Slippage tolerance in percent (default: 0.5)"),
      },
    },
    async ({ tokenIn, tokenOut, amount, minAmountOut, slippage }) => {
      try {
        const swapRouter = getSwapRouterService(NETWORK);
        const account = await getAccount();

        const result = await swapRouter.executeBestSwap(
          account,
          tokenIn,
          tokenOut,
          amount,
          minAmountOut,
          slippage
        );

        return createJsonResponse({
          success: result.success,
          network: NETWORK,
          dex: result.dex,
          note: `Executed through ${result.dex.toUpperCase()} (best rate)`,
          txid: result.txid,
          swap: {
            tokenIn: result.tokenIn,
            tokenOut: result.tokenOut,
            amountIn: result.amountIn,
            expectedAmountOut: result.expectedAmountOut,
          },
          slippage: `${slippage}%`,
          ...(minAmountOut && { minAmountOut }),
          explorerUrl: result.explorerUrl,
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );

  // Get supported DEXes and their status
  server.registerTool(
    "swap_dexes",
    {
      description: `List available DEXes and their status.

Shows which DEXes are configured and available for swapping.`,
    },
    async () => {
      try {
        const { getBitflowService } = await import("../services/bitflow.service.js");
        const bitflowService = getBitflowService(NETWORK);

        return createJsonResponse({
          network: NETWORK,
          dexes: [
            {
              name: "ALEX",
              id: "alex",
              available: NETWORK === "mainnet",
              apiKeyRequired: false,
              note: "Primary Stacks DEX, no API key needed",
            },
            {
              name: "Bitflow",
              id: "bitflow",
              available: NETWORK === "mainnet" && bitflowService.isSdkAvailable(),
              apiKeyRequired: true,
              note: bitflowService.isSdkAvailable()
                ? "DEX aggregator with best routes"
                : "Set BITFLOW_API_KEY to enable",
            },
            {
              name: "Velar",
              id: "velar",
              available: NETWORK === "mainnet",
              apiKeyRequired: false,
              note: "Velar Dharma - powers Xverse swaps",
            },
          ],
          recommendation:
            "Use swap_compare to find best rates across all DEXes, then swap_best for automatic execution",
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );
}
