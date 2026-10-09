/** The MCP server, the Boosty client behind it and the helper every tool is registered with. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { API, Auth, BoostyError, FileAuthDataResolver, TokenPersistError } from "boosty-api";
import { z } from "zod";
import { AUTH_FILE, browserLogin } from "./auth.js";
import { slim } from "./slim.js";

/** Client bound to the stored tokens; boosty-api refreshes them and writes them back itself. */
function createApi(): API {
  return new API({ auth: new Auth(new FileAuthDataResolver(AUTH_FILE)) });
}

// Replaced on login: tools must read it at call time, not keep a copy
export let api = createApi();

/** Sign in through the browser, switch to the new tokens and prove they work. */
export async function login(): Promise<string> {
  await browserLogin();
  api = createApi();
  const user = await api.user.current();
  return `Logged in as ${user.name} (id ${user.id}${user.blogUrl ? `, blog: ${user.blogUrl}` : ""}). Tokens saved to ${AUTH_FILE}`;
}

export const server = new McpServer({ name: "boosty", version: "0.1.0" });

export function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  let hint = "";
  if (error instanceof BoostyError && error.statusCode === 401) {
    hint = "\nNot logged in or the session expired — call the `login` tool.";
  } else if (error instanceof TokenPersistError) {
    hint = `\nThe refreshed tokens could not be written to ${AUTH_FILE} — check that the file is writable.`;
  }
  return `❌ ${message}${hint}`;
}

/** Register a tool whose result is the (slimmed) JSON answer of the API. */
export function tool<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  inputSchema: Shape,
  run: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>,
  kind: "read" | "write" | "destructive" = "read"
): void {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      annotations: { readOnlyHint: kind === "read", destructiveHint: kind === "destructive", openWorldHint: true },
    },
    (async (args: z.infer<z.ZodObject<Shape>>) => {
      try {
        return textResult(JSON.stringify(slim(await run(args))) ?? "null");
      } catch (error) {
        return textResult(describeError(error), true);
      }
    }) as never
  );
}
