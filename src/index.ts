#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HeartbeatAPI } from "./api.js";
import { TOOL_NAME, TOOL_DESCRIPTION, TOOL_SCHEMA, toolHandler, ToolParams } from "./tool.js";
import { setupOAuth } from "./oauth.js";

const server = new McpServer({
  name: "heartbeat-mcp-server",
  version: "1.0.0",
});

async function main(): Promise<void> {
  const apiKey = process.env.HEARTBEAT_API_KEY;
  if (!apiKey) {
    console.error("ERROR: HEARTBEAT_API_KEY environment variable is required");
    process.exit(1);
  }

  const api = new HeartbeatAPI(apiKey);

  server.tool(
    TOOL_NAME,
    TOOL_DESCRIPTION,
    TOOL_SCHEMA,
    async (params) => {
      const result = await toolHandler(api, params as ToolParams);
      return { content: [{ type: "text" as const, text: result }] };
    },
  );

  const PORT = process.env.PORT ? Number(process.env.PORT) : null;

  if (PORT) {
    const express = (await import("express")).default;
    const { StreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/streamableHttp.js"
    );

    const oauthClientId = process.env.MCP_OAUTH_CLIENT_ID;
    const oauthClientSecret = process.env.MCP_OAUTH_CLIENT_SECRET;
    const publicUrl = process.env.PUBLIC_URL;

    if (!oauthClientId || !oauthClientSecret || !publicUrl) {
      console.error("ERROR: MCP_OAUTH_CLIENT_ID, MCP_OAUTH_CLIENT_SECRET, and PUBLIC_URL are required for HTTP transport");
      process.exit(1);
    }

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));

    const { validateToken } = setupOAuth(app, {
      clientId: oauthClientId,
      clientSecret: oauthClientSecret,
      publicUrl,
      staticToken: process.env.MCP_AUTH_TOKEN,
    });

    app.post("/mcp", async (req, res) => {
      if (!validateToken(req)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    app.get("/health", (_req, res) => res.json({ status: "ok" }));

    app.listen(PORT, () => {
      console.error(`Heartbeat MCP server running on http://0.0.0.0:${PORT}/mcp`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Heartbeat MCP server running via stdio");
  }
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
