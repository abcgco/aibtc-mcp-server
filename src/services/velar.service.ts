import {
  VelarSDK,
  type SwapConfig,
  type SwapResponse,
  type AmountOutResponse,
} from "@velarprotocol/velar-sdk";
import {
  makeContractCall,
  broadcastTransaction,
} from "@stacks/transactions";
import { STACKS_MAINNET, STACKS_TESTNET } from "@stacks/network";
import { type Network } from "../config/index.js";
import type { Account, TransferResult } from "../transactions/builder.js";

// ============================================================================
// Types
// ============================================================================

export interface VelarSwapQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  route: string[];
  valid: boolean;
  errorMessage?: string;
}

export interface VelarToken {
  id: string;
  symbol: string;
  name: string;
  contractAddress: string;
  decimals: number;
}

// ============================================================================
// Velar Service
// ============================================================================

export class VelarService {
  private sdk: VelarSDK;
  private initialized = false;

  constructor(private network: Network) {
    this.sdk = new VelarSDK();
  }

  private ensureMainnet(): void {
    if (this.network !== "mainnet") {
      throw new Error("Velar DEX is only available on mainnet");
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.sdk.init();
      this.initialized = true;
    }
  }

  /**
   * Get available trading pairs for a token
   */
  async getPairs(symbol: string): Promise<string[]> {
    this.ensureMainnet();
    await this.ensureInitialized();
    return this.sdk.getPairs(symbol);
  }

  /**
   * Get swap quote
   */
  async getQuote(
    account: string,
    inToken: string,
    outToken: string,
    amount: number,
    slippage: number = 0.5
  ): Promise<VelarSwapQuote> {
    this.ensureMainnet();
    await this.ensureInitialized();

    const swapConfig: SwapConfig = {
      account,
      inToken,
      outToken,
    };

    const swapService = await this.sdk.getSwapInstance(swapConfig);
    const result: AmountOutResponse = await swapService.getComputedAmount({
      amount,
      slippage,
    });

    return {
      tokenIn: inToken,
      tokenOut: outToken,
      amountIn: amount.toString(),
      amountOut: result.value?.toString() || "0",
      route: result.route || [],
      valid: result.valid ?? false,
      errorMessage: result.errorMessage,
    };
  }

  /**
   * Execute swap
   */
  async swap(
    account: Account,
    inToken: string,
    outToken: string,
    amount: number,
    slippage: number = 0.5,
    fee?: bigint
  ): Promise<TransferResult> {
    this.ensureMainnet();
    await this.ensureInitialized();

    const swapConfig: SwapConfig = {
      account: account.address,
      inToken,
      outToken,
    };

    const swapService = await this.sdk.getSwapInstance(swapConfig);
    const swapResponse: SwapResponse = await swapService.swap({
      amount,
      slippage,
    });

    // Build and sign the transaction
    const network = this.network === "mainnet" ? STACKS_MAINNET : STACKS_TESTNET;

    const transaction = await makeContractCall({
      contractAddress: swapResponse.contractAddress,
      contractName: swapResponse.contractName,
      functionName: swapResponse.functionName,
      functionArgs: swapResponse.functionArgs,
      postConditions: swapResponse.postConditions,
      postConditionMode: swapResponse.postConditionMode,
      senderKey: account.privateKey,
      network,
      ...(fee !== undefined && { fee }),
    });

    const broadcastResult = await broadcastTransaction({
      transaction,
      network,
    });

    if ("error" in broadcastResult) {
      throw new Error(`Broadcast failed: ${broadcastResult.error} - ${broadcastResult.reason}`);
    }

    return {
      txid: broadcastResult.txid,
      rawTx: Buffer.from(transaction.serialize()).toString("hex"),
    };
  }
}

// ============================================================================
// Service Singleton
// ============================================================================

let _velarServiceInstance: VelarService | null = null;

export function getVelarService(network: Network): VelarService {
  if (!_velarServiceInstance || _velarServiceInstance["network"] !== network) {
    _velarServiceInstance = new VelarService(network);
  }
  return _velarServiceInstance;
}
