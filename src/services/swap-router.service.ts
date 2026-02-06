import { type Network, getContracts } from "../config/index.js";
import type { Account, TransferResult } from "../transactions/builder.js";
import { getAlexDexService, type SwapQuote as AlexSwapQuote } from "./defi.service.js";
import { getBitflowService, type BitflowSwapQuote } from "./bitflow.service.js";
import { getVelarService, type VelarSwapQuote } from "./velar.service.js";

// ============================================================================
// Types
// ============================================================================

export type TokenSymbol = "BTC" | "sBTC" | "STX" | "ALEX" | "VELAR" | string;

export interface SwapRoute {
  dex: "alex" | "bitflow" | "velar";
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpact?: string;
  route: string[];
  available: boolean;
  error?: string;
}

export interface CompareQuotesResult {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  quotes: SwapRoute[];
  bestQuote: SwapRoute | null;
  recommendation: string;
}

export interface SwapExecuteResult {
  success: boolean;
  dex: string;
  txid: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  expectedAmountOut: string;
  explorerUrl: string;
}

// ============================================================================
// Token Mapping
// ============================================================================

// Common token identifiers across DEXes
const TOKEN_ALIASES: Record<string, Record<string, string>> = {
  alex: {
    STX: "STX",
    WSTX: "STX",
    sBTC: "token-sbtc",
    SBTC: "token-sbtc",
    ALEX: "ALEX",
  },
  bitflow: {
    STX: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx",
    sBTC: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
  },
  velar: {
    STX: "STX",
    sBTC: "sBTC",
  },
};

function resolveToken(dex: string, symbol: string): string {
  const aliases = TOKEN_ALIASES[dex] || {};
  return aliases[symbol.toUpperCase()] || symbol;
}

// ============================================================================
// Swap Router Service
// ============================================================================

export class SwapRouterService {
  private contracts: ReturnType<typeof getContracts>;

  constructor(private network: Network) {
    this.contracts = getContracts(network);
  }

  private ensureMainnet(): void {
    if (this.network !== "mainnet") {
      throw new Error("Swap router is only available on mainnet");
    }
  }

  /**
   * Get quotes from all available DEXes and compare
   */
  async compareQuotes(
    tokenIn: TokenSymbol,
    tokenOut: TokenSymbol,
    amountIn: string,
    userAddress?: string
  ): Promise<CompareQuotesResult> {
    this.ensureMainnet();

    const quotes: SwapRoute[] = [];
    const amount = parseFloat(amountIn);

    // Get ALEX quote
    try {
      const alexService = getAlexDexService(this.network);
      const alexTokenIn = resolveToken("alex", tokenIn);
      const alexTokenOut = resolveToken("alex", tokenOut);
      const amountBigInt = BigInt(Math.floor(amount));
      const senderAddress = userAddress || "SP000000000000000000002Q6VF78";

      const alexQuote = await alexService.getSwapQuote(alexTokenIn, alexTokenOut, amountBigInt, senderAddress);
      quotes.push({
        dex: "alex",
        tokenIn: alexTokenIn,
        tokenOut: alexTokenOut,
        amountIn: alexQuote.amountIn,
        amountOut: alexQuote.amountOut,
        priceImpact: alexQuote.priceImpact,
        route: alexQuote.route,
        available: true,
      });
    } catch (error) {
      quotes.push({
        dex: "alex",
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: "0",
        route: [],
        available: false,
        error: (error as Error).message,
      });
    }

    // Get Bitflow quote (if API key configured)
    try {
      const bitflowService = getBitflowService(this.network);
      if (bitflowService.isSdkAvailable()) {
        const bitflowTokenIn = resolveToken("bitflow", tokenIn);
        const bitflowTokenOut = resolveToken("bitflow", tokenOut);

        const bitflowQuote = await bitflowService.getSwapQuote(
          bitflowTokenIn,
          bitflowTokenOut,
          amount
        );
        quotes.push({
          dex: "bitflow",
          tokenIn: bitflowTokenIn,
          tokenOut: bitflowTokenOut,
          amountIn: bitflowQuote.amountIn,
          amountOut: bitflowQuote.expectedAmountOut,
          route: bitflowQuote.route,
          available: true,
        });
      } else {
        quotes.push({
          dex: "bitflow",
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: "0",
          route: [],
          available: false,
          error: "Bitflow API key not configured",
        });
      }
    } catch (error) {
      quotes.push({
        dex: "bitflow",
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: "0",
        route: [],
        available: false,
        error: (error as Error).message,
      });
    }

    // Get Velar quote
    try {
      const velarService = getVelarService(this.network);
      const velarTokenIn = resolveToken("velar", tokenIn);
      const velarTokenOut = resolveToken("velar", tokenOut);

      const velarQuote = await velarService.getQuote(
        userAddress || "SP000000000000000000002Q6VF78", // Placeholder if no address
        velarTokenIn,
        velarTokenOut,
        amount
      );

      if (velarQuote.valid) {
        quotes.push({
          dex: "velar",
          tokenIn: velarTokenIn,
          tokenOut: velarTokenOut,
          amountIn: velarQuote.amountIn,
          amountOut: velarQuote.amountOut,
          route: velarQuote.route,
          available: true,
        });
      } else {
        quotes.push({
          dex: "velar",
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: "0",
          route: [],
          available: false,
          error: velarQuote.errorMessage || "No route found",
        });
      }
    } catch (error) {
      quotes.push({
        dex: "velar",
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: "0",
        route: [],
        available: false,
        error: (error as Error).message,
      });
    }

    // Find best quote (highest output)
    const availableQuotes = quotes.filter((q) => q.available);
    let bestQuote: SwapRoute | null = null;

    if (availableQuotes.length > 0) {
      bestQuote = availableQuotes.reduce((best, current) => {
        const bestOut = parseFloat(best.amountOut);
        const currentOut = parseFloat(current.amountOut);
        return currentOut > bestOut ? current : best;
      });
    }

    // Generate recommendation
    let recommendation: string;
    if (!bestQuote) {
      recommendation = "No swap routes available for this pair";
    } else if (availableQuotes.length === 1) {
      recommendation = `Only ${bestQuote.dex.toUpperCase()} has liquidity for this pair`;
    } else {
      const savings = availableQuotes
        .filter((q) => q !== bestQuote)
        .map((q) => {
          const diff = parseFloat(bestQuote!.amountOut) - parseFloat(q.amountOut);
          const pct = (diff / parseFloat(q.amountOut)) * 100;
          return `${pct.toFixed(2)}% better than ${q.dex}`;
        })
        .join(", ");
      recommendation = `${bestQuote.dex.toUpperCase()} offers best rate (${savings})`;
    }

    return {
      tokenIn,
      tokenOut,
      amountIn,
      quotes,
      bestQuote,
      recommendation,
    };
  }

  /**
   * Execute swap through specified DEX
   */
  async executeSwap(
    account: Account,
    dex: "alex" | "bitflow" | "velar",
    tokenIn: TokenSymbol,
    tokenOut: TokenSymbol,
    amountIn: string,
    minAmountOut?: string,
    slippage: number = 0.5
  ): Promise<SwapExecuteResult> {
    this.ensureMainnet();

    const amount = parseFloat(amountIn);
    let result: TransferResult;
    let expectedAmountOut: string;

    switch (dex) {
      case "alex": {
        const alexService = getAlexDexService(this.network);
        const alexTokenIn = resolveToken("alex", tokenIn);
        const alexTokenOut = resolveToken("alex", tokenOut);
        const amountBigInt = BigInt(Math.floor(amount));

        // Get quote first for expected output
        const quote = await alexService.getSwapQuote(alexTokenIn, alexTokenOut, amountBigInt, account.address);
        expectedAmountOut = quote.amountOut;

        // Check min output if specified
        if (minAmountOut && parseFloat(expectedAmountOut) < parseFloat(minAmountOut)) {
          throw new Error(
            `Output ${expectedAmountOut} is less than minimum ${minAmountOut}`
          );
        }

        // Calculate minAmountOut from slippage (default 0.5%)
        const expectedOut = BigInt(quote.amountOut);
        const slippageFactor = BigInt(Math.floor((1 - slippage / 100) * 10000));
        const minOut = minAmountOut
          ? BigInt(minAmountOut)
          : (expectedOut * slippageFactor) / 10000n;

        result = await alexService.swap(account, alexTokenIn, alexTokenOut, amountBigInt, minOut);
        break;
      }

      case "bitflow": {
        const bitflowService = getBitflowService(this.network);
        if (!bitflowService.isSdkAvailable()) {
          throw new Error("Bitflow API key not configured");
        }

        const bitflowTokenIn = resolveToken("bitflow", tokenIn);
        const bitflowTokenOut = resolveToken("bitflow", tokenOut);

        // Get quote first
        const quote = await bitflowService.getSwapQuote(bitflowTokenIn, bitflowTokenOut, amount);
        expectedAmountOut = quote.expectedAmountOut;

        // Check min output
        if (minAmountOut && parseFloat(expectedAmountOut) < parseFloat(minAmountOut)) {
          throw new Error(
            `Output ${expectedAmountOut} is less than minimum ${minAmountOut}`
          );
        }

        result = await bitflowService.swap(
          account,
          bitflowTokenIn,
          bitflowTokenOut,
          amount,
          slippage
        );
        break;
      }

      case "velar": {
        const velarService = getVelarService(this.network);
        const velarTokenIn = resolveToken("velar", tokenIn);
        const velarTokenOut = resolveToken("velar", tokenOut);

        // Get quote first
        const quote = await velarService.getQuote(
          account.address,
          velarTokenIn,
          velarTokenOut,
          amount,
          slippage
        );

        if (!quote.valid) {
          throw new Error(quote.errorMessage || "No route found");
        }

        expectedAmountOut = quote.amountOut;

        // Check min output
        if (minAmountOut && parseFloat(expectedAmountOut) < parseFloat(minAmountOut)) {
          throw new Error(
            `Output ${expectedAmountOut} is less than minimum ${minAmountOut}`
          );
        }

        result = await velarService.swap(
          account,
          velarTokenIn,
          velarTokenOut,
          amount,
          slippage
        );
        break;
      }

      default:
        throw new Error(`Unknown DEX: ${dex}`);
    }

    return {
      success: true,
      dex,
      txid: result.txid,
      tokenIn,
      tokenOut,
      amountIn,
      expectedAmountOut,
      explorerUrl: `https://explorer.hiro.so/txid/${result.txid}?chain=mainnet`,
    };
  }

  /**
   * Execute swap through best available DEX
   */
  async executeBestSwap(
    account: Account,
    tokenIn: TokenSymbol,
    tokenOut: TokenSymbol,
    amountIn: string,
    minAmountOut?: string,
    slippage: number = 0.5
  ): Promise<SwapExecuteResult> {
    // Get quotes from all DEXes
    const comparison = await this.compareQuotes(tokenIn, tokenOut, amountIn, account.address);

    if (!comparison.bestQuote) {
      throw new Error("No swap routes available for this pair");
    }

    // Check min output against best quote
    if (minAmountOut && parseFloat(comparison.bestQuote.amountOut) < parseFloat(minAmountOut)) {
      throw new Error(
        `Best output ${comparison.bestQuote.amountOut} is less than minimum ${minAmountOut}`
      );
    }

    // Execute through best DEX
    return this.executeSwap(
      account,
      comparison.bestQuote.dex,
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
      slippage
    );
  }
}

// ============================================================================
// Service Singleton
// ============================================================================

let _swapRouterInstance: SwapRouterService | null = null;

export function getSwapRouterService(network: Network): SwapRouterService {
  if (!_swapRouterInstance || _swapRouterInstance["network"] !== network) {
    _swapRouterInstance = new SwapRouterService(network);
  }
  return _swapRouterInstance;
}
