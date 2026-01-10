#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createApiClient, getWalletAddress, API_URL, NETWORK, getAccount } from "./api.js";
import {
  getStxBalance,
  getTransactionStatus,
  transferStx,
  callContract,
  deployContract,
  broadcastSignedTransaction,
  parseArgToClarityValue,
} from "./wallet.js";
import {
  ALL_ENDPOINTS,
  searchEndpoints,
  formatEndpointsTable,
  getEndpointsBySource,
  getCategories,
} from "./endpoints.js";

const server = new McpServer({
  name: "stx402-agent",
  version: "1.0.0",
});

// =============================================================================
// ENDPOINT DISCOVERY
// =============================================================================

server.registerTool(
  "list_x402_endpoints",
  {
    description: `List known x402 API endpoints from x402.biwas.xyz and stx402.com.

The agent can:
1. Execute x402 endpoints from these sources (paid API calls with automatic payment handling)
2. Execute direct Stacks transactions (transfer STX, call contracts, deploy contracts)

Sources:
- x402.biwas.xyz: DeFi analytics, market data, wallet analysis, Zest/ALEX protocols
- stx402.com: AI services, cryptography, storage, utilities, agent registry`,
    inputSchema: {
      source: z
        .enum(["x402.biwas.xyz", "stx402.com", "all"])
        .optional()
        .default("all")
        .describe("Filter by API source"),
      category: z
        .string()
        .optional()
        .describe("Filter by category (use without value to see available categories)"),
      search: z
        .string()
        .optional()
        .describe("Search endpoints by keyword (searches path, description, category)"),
      showFreeOnly: z
        .boolean()
        .optional()
        .describe("Only show free endpoints (no payment required)"),
      showPaidOnly: z
        .boolean()
        .optional()
        .describe("Only show paid endpoints (require x402 payment)"),
    },
  },
  async ({ source, category, search, showFreeOnly, showPaidOnly }) => {
    try {
      let endpoints = ALL_ENDPOINTS;

      if (source && source !== "all") {
        endpoints = getEndpointsBySource(source);
      }

      if (showFreeOnly) {
        endpoints = endpoints.filter((ep) => ep.cost === "FREE");
      } else if (showPaidOnly) {
        endpoints = endpoints.filter((ep) => ep.cost !== "FREE");
      }

      if (category) {
        endpoints = endpoints.filter(
          (ep) => ep.category.toLowerCase() === category.toLowerCase()
        );
      }

      if (search) {
        const searchResults = searchEndpoints(search);
        endpoints = endpoints.filter((ep) => searchResults.includes(ep));
      }

      if (endpoints.length === 0) {
        const categories = getCategories();
        return {
          content: [
            {
              type: "text",
              text: `No endpoints found matching your criteria.

Available categories: ${categories.join(", ")}

Sources: x402.biwas.xyz, stx402.com

If you're looking to perform a direct blockchain action (transfer STX, call a contract), those are available via separate tools.`,
            },
          ],
        };
      }

      const formatted = formatEndpointsTable(endpoints);
      const sourceInfo =
        source === "all"
          ? "Sources: x402.biwas.xyz, stx402.com"
          : `Source: ${source}`;
      return {
        content: [
          {
            type: "text",
            text: `# Available x402 Endpoints (${endpoints.length} total)\n\n${sourceInfo}\nDefault API: ${API_URL}\n${formatted}\n\n---\nUse execute_x402_endpoint to call any of these endpoints.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// WALLET & BALANCE
// =============================================================================

server.registerTool(
  "get_wallet_info",
  {
    description: "Get the configured wallet address, network, and API URL.",
  },
  async () => {
    try {
      const address = await getWalletAddress();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                address,
                network: NETWORK,
                apiUrl: API_URL,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_stx_balance",
  {
    description: "Get the STX balance for a wallet address.",
    inputSchema: {
      address: z
        .string()
        .optional()
        .describe("Wallet address to check. Uses configured wallet if not provided."),
    },
  },
  async ({ address }) => {
    try {
      const walletAddress = address || (await getWalletAddress());
      const balance = await getStxBalance(walletAddress, NETWORK);

      const stxBalance = (BigInt(balance.stx) / BigInt(1000000)).toString();
      const stxLocked = (BigInt(balance.stxLocked) / BigInt(1000000)).toString();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                address: walletAddress,
                network: NETWORK,
                balance: {
                  stx: stxBalance + " STX",
                  microStx: balance.stx,
                },
                locked: {
                  stx: stxLocked + " STX",
                  microStx: balance.stxLocked,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// DIRECT STACKS TRANSACTIONS
// =============================================================================

server.registerTool(
  "transfer_stx",
  {
    description: `Transfer STX tokens to a recipient address. Signs and broadcasts the transaction.

Example: To send 2 STX, use amount "2000000" (micro-STX).
1 STX = 1,000,000 micro-STX`,
    inputSchema: {
      recipient: z.string().describe("The recipient's Stacks address (starts with SP or ST)"),
      amount: z
        .string()
        .describe("Amount in micro-STX (1 STX = 1,000,000 micro-STX). Example: '2000000' for 2 STX"),
      memo: z.string().optional().describe("Optional memo message to include with the transfer"),
    },
  },
  async ({ recipient, amount, memo }) => {
    try {
      const account = await getAccount();
      const result = await transferStx(account, recipient, BigInt(amount), memo);

      const stxAmount = (BigInt(amount) / BigInt(1000000)).toString();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                txid: result.txid,
                from: account.address,
                recipient,
                amount: stxAmount + " STX",
                amountMicroStx: amount,
                memo: memo || null,
                network: NETWORK,
                explorerUrl: `https://explorer.stacks.co/txid/${result.txid}?chain=${NETWORK}`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text", text: `Error transferring STX: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "call_contract",
  {
    description: `Call a function on a Stacks smart contract. Signs and broadcasts the transaction.

For typed arguments, use objects like {type: 'uint', value: 100} or {type: 'principal', value: 'SP...'}`,
    inputSchema: {
      contractAddress: z.string().describe("The contract deployer's address (e.g., SP2...)"),
      contractName: z.string().describe("The contract name (e.g., 'my-token')"),
      functionName: z.string().describe("The function to call (e.g., 'transfer')"),
      functionArgs: z
        .array(z.unknown())
        .default([])
        .describe("Function arguments. For explicit types: {type: 'uint'|'int'|'principal'|..., value: ...}"),
      postConditionMode: z
        .enum(["allow", "deny"])
        .default("deny")
        .describe("'deny' (default): Blocks unexpected transfers. 'allow': Permits any transfers."),
    },
  },
  async ({ contractAddress, contractName, functionName, functionArgs, postConditionMode }) => {
    try {
      const account = await getAccount();
      const clarityArgs = functionArgs.map(parseArgToClarityValue);

      const { PostConditionMode } = await import("@stacks/transactions");

      const result = await callContract(account, {
        contractAddress,
        contractName,
        functionName,
        functionArgs: clarityArgs,
        postConditionMode:
          postConditionMode === "allow" ? PostConditionMode.Allow : PostConditionMode.Deny,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                txid: result.txid,
                contract: `${contractAddress}.${contractName}`,
                function: functionName,
                args: functionArgs,
                network: NETWORK,
                explorerUrl: `https://explorer.stacks.co/txid/${result.txid}?chain=${NETWORK}`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text", text: `Error calling contract: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "deploy_contract",
  {
    description: "Deploy a Clarity smart contract to the Stacks blockchain.",
    inputSchema: {
      contractName: z.string().describe("Unique name for the contract (lowercase, hyphens allowed)"),
      codeBody: z.string().describe("The complete Clarity source code"),
    },
  },
  async ({ contractName, codeBody }) => {
    try {
      const account = await getAccount();
      const result = await deployContract(account, { contractName, codeBody });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                txid: result.txid,
                contractId: `${account.address}.${contractName}`,
                network: NETWORK,
                explorerUrl: `https://explorer.stacks.co/txid/${result.txid}?chain=${NETWORK}`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text", text: `Error deploying contract: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_transaction_status",
  {
    description: "Check the status of a Stacks transaction by its txid.",
    inputSchema: {
      txid: z.string().describe("The transaction ID (64 character hex string)"),
    },
  },
  async ({ txid }) => {
    try {
      const status = await getTransactionStatus(txid, NETWORK);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                txid,
                ...status,
                network: NETWORK,
                explorerUrl: `https://explorer.stacks.co/txid/${txid}?chain=${NETWORK}`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text", text: `Error getting transaction status: ${message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "broadcast_transaction",
  {
    description: "Broadcast a pre-signed Stacks transaction to the network.",
    inputSchema: {
      signedTx: z.string().describe("The signed transaction as a hex string"),
    },
  },
  async ({ signedTx }) => {
    try {
      const result = await broadcastSignedTransaction(signedTx, NETWORK);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                txid: result.txid,
                network: NETWORK,
                explorerUrl: `https://explorer.stacks.co/txid/${result.txid}?chain=${NETWORK}`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [{ type: "text", text: `Error broadcasting transaction: ${message}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// X402 API ENDPOINTS
// =============================================================================

server.registerTool(
  "execute_x402_endpoint",
  {
    description: `Execute an x402 API endpoint. Payment is handled automatically.

Supported sources:
- x402.biwas.xyz (default): Use path like "/api/pools/trending"
- stx402.com: Use apiUrl="https://stx402.com" with path like "/api/ai/dad-joke"

Use list_x402_endpoints to discover available endpoints.`,
    inputSchema: {
      method: z
        .enum(["GET", "POST", "PUT", "DELETE"])
        .default("GET")
        .describe("HTTP method"),
      path: z.string().describe("API endpoint path (e.g., '/api/pools/trending')"),
      apiUrl: z
        .enum(["https://x402.biwas.xyz", "https://stx402.com"])
        .optional()
        .describe("API base URL. Defaults to configured API_URL (x402.biwas.xyz)."),
      params: z
        .record(z.string(), z.string())
        .optional()
        .describe("Query parameters for GET requests"),
      data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Request body for POST/PUT requests"),
    },
  },
  async ({ method, path, apiUrl, params, data }) => {
    try {
      const baseUrl = apiUrl || API_URL;
      const api = await createApiClient(baseUrl);

      const response = await api.request({
        method,
        url: path,
        params,
        data,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                endpoint: `${method} ${baseUrl}${path}`,
                response: response.data,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      let message = "Unknown error";
      if (error instanceof Error) {
        message = error.message;
      }
      const axiosError = error as { response?: { status?: number; data?: unknown } };
      if (axiosError.response) {
        if (axiosError.response.status === 404) {
          message = `Endpoint not found: ${path}. Use list_x402_endpoints to see available endpoints.`;
        } else {
          message = `HTTP ${axiosError.response.status}: ${JSON.stringify(axiosError.response.data)}`;
        }
      }
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("stx402-agent MCP server running on stdio");
  console.error(`Network: ${NETWORK}`);
  console.error(`API URL: ${API_URL}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
