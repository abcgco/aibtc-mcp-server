import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  probeEndpoint,
  formatPaymentAmount,
  createPlainClient,
  createApiClient,
  getAccount,
  getWalletAddress,
  checkSufficientBalance,
  generateDedupKey,
  checkDedupCache,
  recordTransaction,
} from "../services/x402.service.js";
import { createJsonResponse, createErrorResponse } from "../utils/index.js";

const AIBTC_BASE_URL = "https://aibtc.com";

export function registerInboxTools(server: McpServer): void {
  // =========================================================================
  // get_inbox_messages — list messages for an address (free)
  // =========================================================================
  server.registerTool(
    "get_inbox_messages",
    {
      description: `List inbox messages for a Stacks address on aibtc.com. Free endpoint — no payment required.

If no address is provided, uses the active wallet address.`,
      inputSchema: {
        address: z
          .string()
          .optional()
          .describe(
            "Stacks address to retrieve messages for. Defaults to active wallet."
          ),
      },
    },
    async ({ address }) => {
      try {
        const targetAddress = address || (await getWalletAddress());
        const client = createPlainClient(AIBTC_BASE_URL);
        const response = await client.get(`/api/inbox/${targetAddress}`);
        return createJsonResponse({
          address: targetAddress,
          messages: response.data,
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );

  // =========================================================================
  // get_inbox_message — get a single message by ID (free)
  // =========================================================================
  server.registerTool(
    "get_inbox_message",
    {
      description: `Get a single inbox message by ID on aibtc.com. Free endpoint — no payment required.

If no address is provided, uses the active wallet address.`,
      inputSchema: {
        address: z
          .string()
          .optional()
          .describe(
            "Stacks address that owns the message. Defaults to active wallet."
          ),
        messageId: z.string().describe("The message ID to retrieve."),
      },
    },
    async ({ address, messageId }) => {
      try {
        const targetAddress = address || (await getWalletAddress());
        const client = createPlainClient(AIBTC_BASE_URL);
        const response = await client.get(
          `/api/inbox/${targetAddress}/${messageId}`
        );
        return createJsonResponse({
          address: targetAddress,
          messageId,
          message: response.data,
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );

  // =========================================================================
  // delete_inbox_message — delete a message by ID (free)
  // =========================================================================
  server.registerTool(
    "delete_inbox_message",
    {
      description: `Delete an inbox message by ID on aibtc.com. Free endpoint — no payment required.

If no address is provided, uses the active wallet address.`,
      inputSchema: {
        address: z
          .string()
          .optional()
          .describe(
            "Stacks address that owns the message. Defaults to active wallet."
          ),
        messageId: z.string().describe("The message ID to delete."),
      },
    },
    async ({ address, messageId }) => {
      try {
        const targetAddress = address || (await getWalletAddress());
        const client = createPlainClient(AIBTC_BASE_URL);
        const response = await client.delete(
          `/api/inbox/${targetAddress}/${messageId}`
        );
        return createJsonResponse({
          address: targetAddress,
          messageId,
          deleted: true,
          response: response.data,
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );

  // =========================================================================
  // send_inbox_message — send a message (paid, 100 sats sBTC via x402 v2)
  // =========================================================================
  server.registerTool(
    "send_inbox_message",
    {
      description: `Send a message to an agent inbox on aibtc.com. Costs ~100 sats sBTC.

Safe mode (default): Probes endpoint cost and returns payment info without paying.
To execute: Set autoApprove=true after reviewing cost.

The recipient's BTC and STX addresses are required. Look them up via the aibtc.com agents API
(GET https://aibtc.com/api/agents) or use get_inbox_messages to see known addresses.

Payment is handled via x402 v2 protocol with pre-recorded dedup to prevent drainage on retries.`,
      inputSchema: {
        toStxAddress: z
          .string()
          .describe("Recipient's Stacks address."),
        toBtcAddress: z
          .string()
          .describe("Recipient's Bitcoin address."),
        content: z.string().describe("Message content to send."),
        autoApprove: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "When false (default), probes cost and returns payment info. When true, executes payment and sends message."
          ),
      },
    },
    async ({ toStxAddress, toBtcAddress, content, autoApprove }) => {
      try {
        const account = await getAccount();
        const endpointUrl = `${AIBTC_BASE_URL}/api/inbox/${toStxAddress}`;
        const requestBody: Record<string, unknown> = {
          toBtcAddress,
          toStxAddress,
          content,
        };

        // Probe endpoint for payment requirements
        const probeResult = await probeEndpoint({
          method: "POST",
          url: endpointUrl,
          data: requestBody,
        });

        // Free endpoint — just send
        if (probeResult.type === "free") {
          return createJsonResponse({
            endpoint: `POST ${endpointUrl}`,
            message: "Message sent (endpoint was free).",
            response: probeResult.data,
          });
        }

        // Payment required — safe mode returns cost info
        const { amount, asset, recipient: payTo } = probeResult;
        const formattedCost = formatPaymentAmount(amount, asset);

        if (!autoApprove) {
          return createJsonResponse({
            type: "payment_required",
            endpoint: `POST ${endpointUrl}`,
            message: `Sending a message costs ${formattedCost}. To send and pay, call send_inbox_message again with autoApprove: true.`,
            payment: {
              amount,
              asset,
              recipient: payTo,
              network: probeResult.network,
            },
            callWith: {
              toStxAddress,
              toBtcAddress,
              content,
              autoApprove: true,
            },
          });
        }

        // --- autoApprove=true: execute payment ---

        // Dedup check — prevents duplicate payments on retries
        const dedupKey = generateDedupKey(
          "POST",
          endpointUrl,
          undefined,
          requestBody
        );
        const existingTxid = checkDedupCache(dedupKey);
        if (existingTxid) {
          return createJsonResponse({
            endpoint: `POST ${endpointUrl}`,
            message:
              "Request already processed within the last 60 seconds. This prevents accidental duplicate payments.",
            txid: existingTxid,
            note: "Wait 60s or change message content to send a new transaction.",
          });
        }

        // Check balance before attempting payment
        await checkSufficientBalance(account, amount, asset);

        // PRE-RECORD dedup BEFORE payment — prevents drainage if request fails after payment
        recordTransaction(dedupKey, "pending");

        // Use x402 v2 payment client — handles signing, payload construction, and header encoding
        const api = await createApiClient(AIBTC_BASE_URL);
        const response = await api.post(
          `/api/inbox/${toStxAddress}`,
          requestBody
        );

        // Extract txid from response and update dedup entry
        const txid =
          (response.data as { txid?: string })?.txid ||
          response.headers?.["x-transaction-id"] ||
          "paid";
        recordTransaction(dedupKey, txid);

        return createJsonResponse({
          endpoint: `POST ${endpointUrl}`,
          message: `Message sent to ${toStxAddress}. Payment: ${formattedCost}.`,
          ...(txid !== "paid" && { txid }),
          response: response.data,
        });
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );
}
