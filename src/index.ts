#!/usr/bin/env node
/**
 * Boosty MCP server (stdio) on top of the unofficial `boosty-api` client.
 *
 *   node dist/index.js          start the MCP server
 *   node dist/index.js login    sign in from the terminal (same as the `login` tool)
 *
 * Starts without credentials (public blogs work anonymously); the `login` tool signs in.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { api, login, server } from "./server.js";
// Each module registers its tools on import; the order here is the order of the tool list
import "./tools/account.js";
import "./tools/blog.js";
import "./tools/income.js";
import "./tools/stats.js";
import "./tools/posts.js";
import "./tools/search.js";
import "./tools/polls.js";
import "./tools/comments.js";
import "./tools/messaging.js";

if (process.argv[2] === "login") {
  try {
    console.error("Opening a browser — sign in to Boosty, then close the window…");
    console.error(await login());
    process.exit(0);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

await server.connect(new StdioServerTransport());
console.error(`Boosty MCP server started (${api.auth.isAuthenticated ? "logged in" : "anonymous — call `login`"})`);
