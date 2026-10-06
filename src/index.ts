#!/usr/bin/env node
/**
 * Boosty MCP server (stdio) on top of the unofficial `boosty-api` client.
 *
 *   node dist/index.js          start the MCP server
 *   node dist/index.js login    sign in from the terminal (same as the `login` tool)
 *
 * Starts without credentials (public blogs work anonymously); the `login` tool signs in.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { API, Auth, BoostyError, FileAuthDataResolver, textBlock } from "boosty-api";
import { z } from "zod";
import { AUTH_FILE, browserLogin } from "./auth.js";
import { slim } from "./slim.js";

// boosty-api logs every request with console.log, and stdout belongs to the MCP protocol
console.log = console.error;

/** Client bound to the stored tokens; boosty-api refreshes them and writes them back itself. */
function createApi(): API {
  return new API(undefined, new Auth(new FileAuthDataResolver(AUTH_FILE)));
}

let api = createApi();

/** Sign in through the browser, switch to the new tokens and prove they work. */
async function login(): Promise<string> {
  await browserLogin();
  api = createApi();
  const user = await api.user.current();
  return `Logged in as ${user.name} (id ${user.id}${user.blogUrl ? `, blog: ${user.blogUrl}` : ""}). Tokens saved to ${AUTH_FILE}`;
}

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

const server = new McpServer({ name: "boosty", version: "0.1.0" });

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // An anonymous 401 surfaces as boosty-api's "No refresh token…" error, hence the text match
  const isAuthProblem = (error instanceof BoostyError && error.statusCode === 401) || /refresh/i.test(message);
  return `❌ ${message}${isAuthProblem ? "\nNot logged in or the session expired — call the `login` tool." : ""}`;
}

/** Register a tool whose result is the (slimmed) JSON answer of the API. */
function tool<Shape extends z.ZodRawShape>(
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

// Both go into URL paths unescaped inside boosty-api; "." and ".." would climb out of /v1/blog/<name>/
const blog = z.string().regex(/^(?!\.+$)[\w.-]+$/).describe("Blog name from its URL: boosty.to/<blog>");
const postId = z.string().regex(/^[\w-]+$/).describe("Post id (UUID from the post URL)");
const limit = z.number().int().positive().optional().describe("Max items per page");
const replyLimit = z.number().int().optional().describe("Replies to embed per comment");
const offset = z.string().optional().describe("Pagination cursor: `extra.offset` (or `offset`) of the previous page");

// ─── Account ────────────────────────────────────────────

server.registerTool(
  "login",
  {
    description:
      "Sign in to Boosty: opens a browser window where the user logs in and then CLOSES the window " +
      "(tell them to); the access/refresh tokens are read from the kept browser profile afterwards and " +
      "saved. The call waits for the window to close (up to 5 minutes). Needed for " +
      "paid content, the feed, messages, subscribers and every write; public blogs work without it.",
    inputSchema: {},
    annotations: { openWorldHint: true },
  },
  async () => {
    try {
      return textResult(`✅ ${await login()}`);
    } catch (error) {
      return textResult(`❌ Login failed: ${(error as Error).message}`, true);
    }
  }
);

tool("get_current_user", "The logged-in Boosty user (id, name, email, own blog). Also tells whether a login is active.", {}, () =>
  api.user.current()
);

// ─── Blog ───────────────────────────────────────────────

tool("get_blog", "Blog profile: title, description, owner, counters, whether the current user is subscribed.", { blog }, (args) =>
  api.blog.profile(args.blog)
);

tool(
  "list_subscription_levels",
  "Subscription levels (tiers) of a blog with prices.",
  { blog, show_free_level: z.boolean().optional().describe("Include the free 'follower' level") },
  (args) => api.blog.subscriptionLevels(args.blog, { showFreeLevel: args.show_free_level })
);

tool(
  "list_subscribers",
  "Subscribers of a blog (blog owner only): level, price, total payments, subscription and next payment dates.",
  {
    blog,
    limit,
    offset,
    sort_by: z.string().optional().describe('Sort field, e.g. "on_time" (subscription date) or "payments"'),
    order: z.enum(["gt", "lt"]).optional().describe("Sort direction: gt — descending, lt — ascending"),
    with_followers: z.boolean().optional().describe("Include free followers"),
  },
  (args) =>
    api.blog.subscribers(args.blog, {
      limit: args.limit,
      offset: args.offset,
      sortBy: args.sort_by,
      order: args.order,
      withFollowers: args.with_followers,
    })
);

tool("list_blacklist", "Users blacklisted in a blog (blog owner only).", { blog }, (args) => api.blog.blacklist(args.blog));

tool(
  "get_sales",
  "Income feed of the logged-in author: subscription payments, donations, one-time purchases. Boosty answers " +
    '"Category disabled" when monetization statistics are not enabled for the account.',
  {
    type: z.enum(["subscription", "donation", "purchase", "single", "all"]).optional(),
    limit,
    offset,
    period: z.string().optional().describe("Period filter, passed to Boosty as is"),
  },
  (args) => api.income.sales(args)
);

// ─── Posts ──────────────────────────────────────────────

tool(
  "list_posts",
  "Posts of a blog, newest first. `hasAccess: false` marks posts closed for the current user (only the teaser is returned).",
  {
    blog,
    limit,
    offset,
    comments_limit: z.number().int().optional().describe("Comments to embed per post"),
    from_ts: z.number().int().optional().describe("Only posts published after this unix time (seconds)"),
    to_ts: z.number().int().optional().describe("Only posts published before this unix time (seconds)"),
  },
  (args) =>
    api.posts.list(args.blog, {
      limit: args.limit ?? 10,
      offset: args.offset,
      commentsLimit: args.comments_limit,
      fromTs: args.from_ts,
      toTs: args.to_ts,
    })
);

tool(
  "get_post",
  "One post with its text, media (image/video/audio/file links) and first comments.",
  {
    blog,
    post_id: postId,
    comments_limit: z.number().int().optional().describe("Comments to embed"),
    reply_limit: replyLimit,
  },
  (args) => api.posts.get(args.blog, args.post_id, { commentsLimit: args.comments_limit, replyLimit: args.reply_limit })
);

tool(
  "delete_post",
  "Delete a post from the user's own blog. Irreversible.",
  { blog, post_id: postId },
  (args) => api.posts.delete(args.blog, args.post_id),
  "destructive"
);

tool(
  "list_media",
  "Media of a blog gathered from its posts (images, videos, audio), grouped by post.",
  {
    blog,
    type: z.enum(["all", "image", "ok_video", "audio_file"]).optional().describe("Media type, default all"),
    limit,
    offset,
  },
  // Raw request: api.media.list() of boosty-api 0.2.0 crashes on the real answer ({ data: { mediaPosts } })
  (args) =>
    api.request("GET", `/v1/blog/${args.blog}/media_album/`, {
      params: { type: args.type ?? "all", limit_by: "media", limit: args.limit, offset: args.offset },
    })
);

tool(
  "get_feed",
  "Personal feed: new posts of the blogs the logged-in user follows.",
  { limit, offset, only_allowed: z.boolean().optional().describe("Only posts the user has access to") },
  (args) => api.feed.posts({ limit: args.limit ?? 10, offset: args.offset, onlyAllowed: args.only_allowed })
);

tool(
  "search_blogs",
  "Search Boosty blogs by name (requires login).",
  { query: z.string(), limit, offset },
  (args) => api.feed.searchBlogs(args.query, { limit: args.limit, offset: args.offset })
);

tool(
  "like_post",
  "Like a post. Experimental: the endpoint is reconstructed from the web client.",
  { blog, post_id: postId },
  (args) => api.social.likePost(args.blog, args.post_id),
  "write"
);

tool(
  "unlike_post",
  "Remove the like from a post. Experimental: the endpoint is reconstructed from the web client.",
  { blog, post_id: postId },
  (args) => api.social.unlikePost(args.blog, args.post_id),
  "write"
);

// ─── Comments ───────────────────────────────────────────

tool(
  "list_comments",
  "Comments of a post.",
  {
    blog,
    post_id: postId,
    limit,
    offset,
    reply_limit: replyLimit,
    order: z.string().optional().describe('Sort order, e.g. "top"'),
  },
  (args) =>
    api.comments.list(args.blog, args.post_id, {
      limit: args.limit,
      offset: args.offset,
      replyLimit: args.reply_limit,
      order: args.order,
    })
);

tool(
  "list_comment_replies",
  "Replies to a comment. Experimental: the endpoint is reconstructed from the web client.",
  { blog, post_id: postId, comment_id: z.number().int().describe("`intId` of the comment"), limit, offset },
  (args) => api.comments.replies(args.blog, args.post_id, args.comment_id, { limit: args.limit, offset: args.offset })
);

tool(
  "create_comment",
  "Write a plain-text comment under a post, or a reply to a comment. Experimental: the request body is " +
    "reconstructed from the web client.",
  {
    blog,
    post_id: postId,
    text: z.string().min(1),
    reply_to_id: z.number().int().optional().describe("`intId` of the comment to reply to"),
  },
  (args) => api.comments.create(args.blog, args.post_id, [textBlock(args.text)], { replyToId: args.reply_to_id }),
  "write"
);

// ─── Messages ───────────────────────────────────────────

const dialogId = z.number().int().describe("Dialog id (from list_dialogs / get_dialog_with_user)");
const userId = z.number().int().describe("Boosty user id");

tool("list_dialogs", "Direct-message dialogs of the logged-in user with the last message of each.", { limit, offset }, (args) =>
  api.messaging.dialogs(args)
);

tool(
  "get_dialog_with_user",
  "Check the dialog with a user: its id if it exists, and `relation.canWrite` — whether the user can be " +
    "messaged at all (closed DMs and blacklists are common). Call before create_dialog.",
  { user_id: userId },
  (args) => api.messaging.dialogWithUser(args.user_id)
);

tool(
  "create_dialog",
  "Open a dialog with a user (e.g. a subscriber) so that a message can be sent first. Returns the dialog.",
  { user_id: userId },
  (args) => api.messaging.createDialog(args.user_id),
  "write"
);

tool("list_messages", "Messages of a dialog.", { dialog_id: dialogId, limit, offset }, (args) =>
  api.messaging.messages(args.dialog_id, { limit: args.limit, offset: args.offset })
);

tool(
  "send_message",
  "Send a plain-text direct message into a dialog.",
  { dialog_id: dialogId, text: z.string().min(1) },
  (args) => api.messaging.sendMessage(args.dialog_id, [textBlock(args.text)]),
  "write"
);

await server.connect(new StdioServerTransport());
console.error(`Boosty MCP server started (${api.auth.isAuthenticated ? "logged in" : "anonymous — call `login`"})`);
