#!/usr/bin/env bun
/**
 * Remote MCP Server for stx402-agent
 *
 * This server exposes the MCP protocol over HTTP, allowing Claude Code
 * to connect remotely via:
 *
 *   claude mcp add --transport http stx402 https://your-server.com/mcp \
 *     --header "X-API-Key: your-api-key"
 *
 * Features:
 * - All 54 tools available
 * - Per-user wallet isolation via API key
 * - Encrypted wallet storage (AES-256-GCM + Scrypt)
 * - Works with Bun runtime
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { registerAllTools } from "./tools/index.js";
import { NETWORK, API_URL } from "./config/index.js";
import { setUserContext, clearUserContext } from "./context.js";

// Create the MCP server
const server = new McpServer({
  name: "stx402-agent",
  version: "3.0.0",
});

// Register all tools
registerAllTools(server);

// Create a stateless transport
const transport = new WebStandardStreamableHTTPServerTransport();

// Create the Hono app
const app = new Hono();

// CORS configuration for MCP clients
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "mcp-session-id",
      "Last-Event-ID",
      "mcp-protocol-version",
      "X-API-Key",
      "Authorization",
    ],
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
  })
);

// Health check endpoint
app.get("/health", (c) =>
  c.json({
    status: "ok",
    version: "3.0.0",
    network: NETWORK,
    apiUrl: API_URL,
  })
);

// Landing page
app.get("/", (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>stx402-agent - Remote MCP Server</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e4e4e4;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(90deg, #f97316, #eab308);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle { color: #9ca3af; margin-bottom: 2rem; }
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    h2 { color: #f97316; margin-bottom: 1rem; font-size: 1.25rem; }
    code {
      background: rgba(0,0,0,0.3);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-family: 'Fira Code', monospace;
      font-size: 0.9rem;
    }
    pre {
      background: rgba(0,0,0,0.4);
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1rem 0;
    }
    pre code { background: none; padding: 0; }
    .btn {
      display: inline-block;
      background: linear-gradient(90deg, #f97316, #eab308);
      color: #000;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin-top: 1rem;
      cursor: pointer;
      border: none;
    }
    .btn:hover { opacity: 0.9; }
    .api-key {
      font-family: monospace;
      font-size: 1.1rem;
      padding: 0.75rem;
      background: rgba(249,115,22,0.2);
      border-radius: 8px;
      word-break: break-all;
    }
    .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .feature {
      background: rgba(255,255,255,0.03);
      padding: 1rem;
      border-radius: 8px;
      border-left: 3px solid #f97316;
    }
    .feature h3 { color: #f97316; font-size: 1rem; margin-bottom: 0.5rem; }
    .feature p { color: #9ca3af; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔥 stx402-agent</h1>
    <p class="subtitle">Remote MCP Server for Stacks Blockchain & x402 Payments</p>

    <div class="card">
      <h2>🔑 Step 1: Generate Your API Key</h2>
      <p>Your API key identifies your wallet storage. Keep it safe!</p>
      <div id="key-display" class="api-key" style="margin: 1rem 0; display: none;"></div>
      <button class="btn" onclick="generateKey()">Generate New API Key</button>
      <p style="margin-top: 1rem; color: #9ca3af; font-size: 0.85rem;">
        ⚠️ Save this key! It's generated locally and we don't store it.
      </p>
    </div>

    <div class="card">
      <h2>⚡ Step 2: Connect Claude Code</h2>
      <p>Run this command in your terminal:</p>
      <pre><code>claude mcp add --transport http stx402 ${c.req.url.replace(/\/$/, "")}/mcp \\
  --header "X-API-Key: YOUR_API_KEY"</code></pre>
    </div>

    <div class="card">
      <h2>🚀 Features</h2>
      <div class="features">
        <div class="feature">
          <h3>💰 Wallet Management</h3>
          <p>Create, import, and manage encrypted wallets</p>
        </div>
        <div class="feature">
          <h3>💸 STX Transfers</h3>
          <p>Send STX, tokens, and NFTs</p>
        </div>
        <div class="feature">
          <h3>📊 DeFi</h3>
          <p>ALEX DEX swaps, Zest Protocol lending</p>
        </div>
        <div class="feature">
          <h3>🔗 x402 APIs</h3>
          <p>Paid API calls with automatic payment</p>
        </div>
        <div class="feature">
          <h3>📜 Smart Contracts</h3>
          <p>Deploy and call Clarity contracts</p>
        </div>
        <div class="feature">
          <h3>🔐 Secure</h3>
          <p>AES-256-GCM encrypted wallet storage</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>📚 Documentation</h2>
      <p>
        <a href="https://github.com/biwasxyz/stx402-agent" style="color: #f97316;">GitHub Repository</a> •
        <a href="${c.req.url.replace(/\/$/, "")}/health" style="color: #f97316;">Health Check</a>
      </p>
    </div>
  </div>

  <script>
    function generateKey() {
      const key = crypto.randomUUID();
      const display = document.getElementById('key-display');
      display.textContent = key;
      display.style.display = 'block';
      navigator.clipboard.writeText(key).then(() => {
        alert('API Key copied to clipboard!');
      });
    }
  </script>
</body>
</html>`;
  return c.html(html);
});

// API Key validation middleware for MCP endpoint
app.use("/mcp", async (c, next) => {
  const apiKey =
    c.req.header("X-API-Key") ||
    c.req.header("Authorization")?.replace("Bearer ", "");

  if (!apiKey) {
    return c.json(
      {
        error: "Missing API Key",
        message:
          "Please provide your API key via X-API-Key header or Authorization: Bearer <key>",
        help: "Visit the root URL to generate an API key",
      },
      401
    );
  }

  // Validate API key format (UUID)
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(apiKey)) {
    return c.json(
      {
        error: "Invalid API Key format",
        message: "API key must be a valid UUID",
      },
      401
    );
  }

  // Set user context for this request
  setUserContext(apiKey);

  try {
    await next();
  } finally {
    // Clear context after request
    clearUserContext();
  }
});

// MCP endpoint
app.all("/mcp", (c) => transport.handleRequest(c.req.raw));

// Connect MCP server to transport
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || "0.0.0.0";

server.connect(transport).then(() => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🔥 stx402-agent Remote MCP Server                           ║
║                                                               ║
║   Network:     ${NETWORK.padEnd(45)}║
║   API URL:     ${API_URL.padEnd(45)}║
║   Server:      http://${HOST}:${PORT}${" ".repeat(Math.max(0, 37 - HOST.length - String(PORT).length))}║
║   MCP:         http://${HOST}:${PORT}/mcp${" ".repeat(Math.max(0, 33 - HOST.length - String(PORT).length))}║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

// Export for Bun's native server (auto-detected)
// When Bun sees a default export with fetch, it automatically serves it
export default {
  port: PORT,
  hostname: HOST,
  fetch: app.fetch,
};
