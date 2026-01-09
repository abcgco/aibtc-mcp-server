#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createApiClient, getWalletAddress, API_URL, NETWORK } from "./api.js";

const server = new McpServer({
  name: "stx402-agent",
  version: "1.0.0",
});

// Tool: Get wallet info
server.tool(
  "get_wallet_info",
  "Get the configured wallet address and network",
  {},
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

// Tool: Check position health (Zest protocol)
server.tool(
  "check_position_health",
  "Check the health status of your Zest protocol position. This endpoint requires x402 payment which will be handled automatically.",
  {
    address: z
      .string()
      .optional()
      .describe("Wallet address to check. Uses configured wallet if not provided."),
  },
  async ({ address }) => {
    try {
      const api = await createApiClient();
      const walletAddress = address || (await getWalletAddress());

      const response = await api.get(`/api/zest/position-health`, {
        params: { address: walletAddress },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      let message = "Unknown error";
      if (error instanceof Error) {
        message = error.message;
      }
      // Check for axios error details
      const axiosError = error as { response?: { status?: number; data?: unknown } };
      if (axiosError.response) {
        message = `HTTP ${axiosError.response.status}: ${JSON.stringify(axiosError.response.data)}`;
      }
      return {
        content: [{ type: "text", text: `Error checking position health: ${message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Execute any x402 endpoint
server.tool(
  "execute_x402_endpoint",
  "Execute any x402 endpoint. The x402 payment will be handled automatically if required.",
  {
    method: z
      .enum(["GET", "POST", "PUT", "DELETE"])
      .default("GET")
      .describe("HTTP method"),
    path: z.string().describe("API path (e.g., /api/zest/position-health)"),
    params: z
      .record(z.string())
      .optional()
      .describe("Query parameters as key-value pairs"),
    data: z
      .record(z.unknown())
      .optional()
      .describe("Request body for POST/PUT requests"),
  },
  async ({ method, path, params, data }) => {
    try {
      const api = await createApiClient();

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
            text: JSON.stringify(response.data, null, 2),
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
        message = `HTTP ${axiosError.response.status}: ${JSON.stringify(axiosError.response.data)}`;
      }
      return {
        content: [{ type: "text", text: `Error executing endpoint: ${message}` }],
        isError: true,
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("stx402-agent MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
