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
import {
  API,
  Auth,
  BoostyError,
  FileAuthDataResolver,
  type NotificationSwitch,
  type NotificationTransport,
  textBlock,
  TokenPersistError,
} from "boosty-api";
import { z } from "zod";
import { AUTH_FILE, browserLogin } from "./auth.js";
import { slim, textBlocks } from "./slim.js";

/** Client bound to the stored tokens; boosty-api refreshes them and writes them back itself. */
function createApi(): API {
  return new API({ auth: new Auth(new FileAuthDataResolver(AUTH_FILE)) });
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
  let hint = "";
  if (error instanceof BoostyError && error.statusCode === 401) {
    hint = "\nNot logged in or the session expired — call the `login` tool.";
  } else if (error instanceof TokenPersistError) {
    hint = `\nThe refreshed tokens could not be written to ${AUTH_FILE} — check that the file is writable.`;
  }
  return `❌ ${message}${hint}`;
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

// Both go into URL paths; "." and ".." would climb out of /v1/blog/<name>/ (boosty-api rejects them too)
const blog = z.string().regex(/^(?!\.+$)[\w.-]+$/).describe("Blog name from its URL: boosty.to/<blog>");
const postId = z.string().regex(/^[\w-]+$/).describe("Post id (UUID from the post URL)");
const limit = z.number().int().positive().optional().describe("Max items per page");
const replyLimit = z.number().int().optional().describe("Replies to embed per comment");
const offset = z.string().optional().describe("Pagination cursor: `extra.offset` (or `offset`) of the previous page");
const skip = z.number().int().min(0).optional().describe("Items to skip");
const unixTime = z.number().int().describe("Unix time, seconds");
const order = z.enum(["gt", "lt"]).optional().describe("Sort direction: gt — descending, lt — ascending");
const levelId = z.number().int().describe("Subscription level id (list_subscription_levels)");
const userId = z.number().int().describe("Boosty user id");
const page = (args: { limit?: number; offset?: string }) => ({ limit: args.limit, offset: args.offset });
const reaction = z
  .string()
  .min(1)
  .describe('Reaction name: "like", "dislike", "heart", "fire", "laugh", "wonder", "sad", "angry", …');

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

tool(
  "list_subscriptions",
  "Blogs the logged-in user is subscribed to.",
  { limit, offset: skip, with_follow: z.boolean().optional().describe("Include free follows") },
  (args) => api.user.subscriptions({ limit: args.limit, offset: args.offset, withFollow: args.with_follow })
);

tool("list_sessions", "Devices the account is logged in on; `flags.isCurrent` marks this server's session.", {}, () =>
  api.user.sessions()
);

const transport = z.enum(["standalone", "mobile_push", "telegram", "mail"] as const satisfies readonly NotificationTransport[]);

tool(
  "get_notification_settings",
  "Notification switches of the account per transport (site, push, Telegram, e-mail).",
  { transports: z.array(transport).min(1).optional().describe("Default: all four") },
  (args) => api.user.notificationSettings(args.transports)
);

tool(
  "list_payment_cards",
  "Saved payment cards of the logged-in user.",
  { currency: z.string().optional(), with_deleted: z.boolean().optional() },
  (args) => api.user.paymentCards({ currency: args.currency, withDeleted: args.with_deleted })
);

tool("list_blog_currencies", "Currencies the logged-in user may choose for their blog.", {}, () =>
  api.user.availableBlogCurrencies()
);

tool(
  "update_profile",
  "Change the account profile; only the given fields are sent. Experimental: the request is reconstructed " +
    "from the web client.",
  {
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    can_view_adult_content: z.boolean().optional(),
    send_msg_rule: z.string().optional().describe("Who may message the user, passed to Boosty as is"),
    send_msg_level_id: levelId.optional(),
  },
  (args) =>
    api.user.updateProfile({
      name: args.name,
      email: args.email,
      canViewAdultContent: args.can_view_adult_content,
      sendMsgRule: args.send_msg_rule,
      sendMsgLevelId: args.send_msg_level_id,
    }),
  "write"
);

tool(
  "update_notification_setting",
  "Turn one notification switch on or off for one transport. Experimental: the endpoint is reconstructed " +
    "from the web client.",
  {
    transport,
    switch: z.enum([
      "new_comment",
      "new_donation",
      "new_message",
      "buy_message",
      "other_news",
      "new_promo",
      "new_referal",
      "new_target",
      "new_post",
      "buy_post",
      "buy_bundle",
      "new_referal_blogger",
      "new_reply",
      "new_stream",
      "new_subscriber",
      "level_subscribers_limit_reached",
    ] as const satisfies readonly NotificationSwitch[]),
    value: z.boolean(),
  },
  (args) => api.user.updateNotificationSetting(args.transport, args.switch, args.value),
  "write"
);

tool(
  "update_dialog_settings",
  "Change who may start a conversation with the user; omitted switches keep their current value. " +
    "Experimental: the endpoint is reconstructed from the web client.",
  {
    send_msg_level_id: levelId.optional().describe("Minimal subscription level that may write"),
    can_send_all: z.boolean().optional(),
    can_send_donation: z.boolean().optional(),
    can_send_my_authors: z.boolean().optional(),
    can_send_paid_subscribers: z.boolean().optional(),
    can_send_subscribers: z.boolean().optional(),
    can_send_payers: z.boolean().optional(),
  },
  (args) =>
    api.user.updateDialogSettings({
      sendMsgLevelId: args.send_msg_level_id,
      canSendAll: args.can_send_all,
      canSendDonation: args.can_send_donation,
      canSendMyAuthors: args.can_send_my_authors,
      canSendPaidSubscribers: args.can_send_paid_subscribers,
      canSendSubscribers: args.can_send_subscribers,
      canSendPayers: args.can_send_payers,
    }),
  "write"
);

tool(
  "set_locale",
  'Set the interface language of the account, e.g. "ru" or "en". Experimental: the endpoint is reconstructed ' +
    "from the web client.",
  { locale: z.string().min(2) },
  (args) => api.user.setLocale(args.locale),
  "write"
);

tool(
  "end_sessions",
  "Log the account out on its devices. It cannot target one device and most likely ends EVERY session, this " +
    "server's included — a new `login` is needed afterwards. Ask the user before calling. Experimental.",
  { including_current: z.literal(true).describe("Confirmation that this session may end too") },
  () => api.user.endSessions({ includingCurrent: true }),
  "destructive"
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
    order,
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
  "get_subscription_level",
  "One subscription level of a blog with its details.",
  {
    blog,
    level_id: levelId,
    with_content_counters: z.boolean().optional().describe("Add the number of posts per content type"),
  },
  (args) => api.blog.subscriptionLevel(args.blog, args.level_id, { withContentCounters: args.with_content_counters })
);

tool(
  "list_unsubscribe_reasons",
  'Answers to the "why did you unsubscribe" survey (blog owner only).',
  {
    blog,
    limit,
    offset,
    sort_by: z.string().optional().describe("Sort field, passed to Boosty as is"),
    order,
    level_ids: z.array(levelId).optional(),
    answers: z.array(z.number().int()).optional().describe("Only these answer ids"),
    from: unixTime.optional(),
    to: unixTime.optional(),
  },
  ({ blog: blogName, sort_by, level_ids, ...options }) =>
    api.blog.unsubscribeReasons(blogName, { ...options, sortBy: sort_by, levelIds: level_ids })
);

// ─── Goals ──────────────────────────────────────────────

const targetId = z.number().int().describe("Goal id (list_targets)");
const targetType = z.enum(["money", "subscribers"]);
const targetFields = {
  description: z.string().min(1),
  target_sum: z.number().positive().describe("Sum in the blog currency, or the number of subscribers"),
};

tool(
  "list_targets",
  "Goals of a blog (the progress bars: money or subscribers).",
  {
    blog,
    type: targetType.optional(),
    show_deleted: z.boolean().optional().describe("Include finished and removed goals"),
  },
  (args) => api.targets.list(args.blog, { type: args.type, showDeleted: args.show_deleted })
);

tool("get_target", "One goal.", { target_id: targetId, currency: z.string().optional() }, (args) =>
  api.targets.get(args.target_id, { currency: args.currency })
);

tool(
  "create_target",
  "Create a goal in the user's own blog. Experimental: the endpoint is reconstructed from the web client.",
  { blog, type: targetType, ...targetFields },
  (args) =>
    args.type === "money"
      ? api.targets.createMoney(args.blog, args.description, args.target_sum)
      : api.targets.createSubscribers(args.blog, args.description, args.target_sum),
  "write"
);

tool(
  "update_target",
  "Change the description and sum of a goal (both are required). Experimental: the endpoint is reconstructed " +
    "from the web client.",
  { target_id: targetId, ...targetFields },
  (args) => api.targets.edit(args.target_id, { description: args.description, targetSum: args.target_sum }),
  "write"
);

tool(
  "delete_target",
  "Remove a goal. Experimental: the endpoint is reconstructed from the web client.",
  { target_id: targetId },
  (args) => api.targets.remove(args.target_id),
  "destructive"
);

// ─── Income ─────────────────────────────────────────────
// Blog owner only. Donation payers and payout data carry e-mails and payout details.

const salesList = { blog, limit, offset, sort_by: z.enum(["time", "amount"]).optional(), order };
const paidKind = z.enum(["post", "bundle"]).describe("Paid posts or paid bundles");

tool(
  "list_donations",
  "Donations received by the blog: donor (with e-mail), amount, message, what it was attached to.",
  {
    ...salesList,
    type: z.enum(["post", "dialog"]).optional().describe("Only donations attached to posts or to dialogs"),
    target_id: z.number().int().optional().describe("Only donations of this post or dialog"),
  },
  ({ blog: blogName, sort_by, target_id, ...options }) =>
    api.income.donations(blogName, { ...options, sortBy: sort_by, targetId: target_id })
);

tool(
  "list_post_sales",
  "Sales of paid posts of the blog.",
  { ...salesList, post_ids: z.array(postId).optional().describe("Only these posts") },
  ({ blog: blogName, sort_by, post_ids, ...options }) =>
    api.income.postSales(blogName, { ...options, sortBy: sort_by, postIds: post_ids })
);

tool(
  "list_bundle_sales",
  "Sales of paid bundles of the blog.",
  { ...salesList, bundle_ids: z.array(z.number().int()).optional().describe("Only these bundles") },
  ({ blog: blogName, sort_by, bundle_ids, ...options }) =>
    api.income.bundleSales(blogName, { ...options, sortBy: sort_by, bundleIds: bundle_ids })
);

tool("list_holds", "Payments the platform still holds before they reach the balance.", { blog, limit, offset }, (args) =>
  api.income.holds(args.blog, page(args))
);

tool(
  "list_broadcast_sales",
  "Statistics of paid mass mailings to dialogs: sent, viewed, sold, earned.",
  { blog, limit, offset },
  (args) => api.income.broadcastSales(args.blog, page(args))
);

tool(
  "get_paid_sales_by_date",
  "Sales of paid posts or bundles within a time range.",
  { blog, kind: paidKind, from: unixTime, to: unixTime },
  (args) =>
    args.kind === "post"
      ? api.income.postSalesByDate(args.blog, args.from, args.to)
      : api.income.bundleSalesByDate(args.blog, args.from, args.to)
);

tool(
  "get_paid_sales_days",
  "Days of one month that have sales of paid posts or bundles.",
  { blog, kind: paidKind, date: unixTime.describe("Any unix time (seconds) inside the month") },
  (args) =>
    args.kind === "post" ? api.income.postSalesDays(args.blog, args.date) : api.income.bundleSalesDays(args.blog, args.date)
);

tool("list_payout_methods", "Payout systems Boosty offers (system, currency).", {}, () => api.income.payoutMethods());

tool(
  "list_payouts",
  "Payout destinations bound to the blog: priority, active flag, last payout status. Holds the owner's " +
    "private payout details.",
  { blog },
  (args) => api.income.payouts(args.blog)
);

tool("list_payout_history", "History of payouts to the blog owner.", { blog, limit, offset }, (args) =>
  api.income.payoutHistory(args.blog, page(args))
);

tool("get_default_currency", "Default currency Boosty picks for a guest (asked anonymously).", {}, () =>
  api.income.defaultCurrency()
);

// ─── Statistics ─────────────────────────────────────────
// Blog owner only: the numbers of the creator dashboard.

const sourceStat = {
  blog,
  type: z.enum(["referer", "utm"]).describe("What to group by"),
  period: z.enum(["day", "week", "month"]),
  limit,
  offset,
  order,
  timestamp: unixTime.optional(),
};
const reportType = z.enum(["donations", "subscriptions", "holds", "payouts"]);

tool("get_stats_summary", "Balance, income, holds, payouts and follower count of the blog.", { blog }, (args) =>
  api.stats.summary(args.blog)
);

tool(
  "get_stats_metrics",
  "Money and counts per source for a period: total, subscriptions, donations, new and lost subscribers.",
  { blog, from: unixTime, to: unixTime },
  (args) => api.stats.metrics(args.blog, args.from, args.to)
);

tool(
  "get_stats_charts",
  "Daily series per metric, newest first.",
  { blog, limit, last_time: unixTime.optional().describe("Paging cursor: the oldest time of the previous page") },
  (args) => api.stats.charts(args.blog, { limit: args.limit, lastTime: args.last_time })
);

tool(
  "list_stats_events",
  "Money and subscription events of the blog (subscribe, unsubscribe, recurrent payment, post purchase, " +
    "donation, payout). Rows carry the subscriber's e-mail.",
  {
    blog,
    limit,
    offset,
    from: unixTime.optional(),
    to: unixTime.optional(),
    event_types: z
      .array(z.string())
      .optional()
      .describe('E.g. "subscribe", "unsubscribe", "recurrent", "buy_post", "donation_target", "payout"'),
    user_ids: z.array(userId).optional(),
  },
  ({ blog: blogName, event_types, user_ids, ...options }) =>
    api.stats.events(blogName, { ...options, eventTypes: event_types, userIds: user_ids })
);

tool(
  "list_visit_sources",
  "Visits of the blog grouped by referer or utm tag.",
  { ...sourceStat, sort_by: z.enum(["view_count", "view_uniq_count"]).optional() },
  ({ blog: blogName, sort_by, ...options }) => api.stats.visits(blogName, { ...options, sortBy: sort_by })
);

tool(
  "list_payment_sources",
  "Payments of the blog grouped by referer or utm tag.",
  sourceStat,
  ({ blog: blogName, ...options }) => api.stats.paymentSources(blogName, options)
);

tool("get_referral_stats", "Referral programme totals of the blog.", { blog }, (args) => api.stats.referrals(args.blog));

tool(
  "list_referral_users",
  "Users brought in by the referral programme.",
  { blog, limit, offset, only_bloggers: z.boolean().optional() },
  (args) => api.stats.referralUsers(args.blog, { ...page(args), onlyBloggers: args.only_bloggers })
);

tool(
  "search_subscribers",
  "Search among the subscribers of the blog by name.",
  { blog, query: z.string().min(3).describe("At least 3 characters"), limit },
  (args) => api.stats.searchUsers(args.blog, args.query, { limit: args.limit })
);

tool(
  "get_post_stats",
  "Statistics of one post. Experimental: the endpoint is reconstructed from the web client.",
  { blog, post_id: postId },
  (args) => api.stats.post(args.blog, args.post_id)
);

tool(
  "build_report",
  "Build a new report file (donations, subscriptions, holds or payouts) and return its descriptor; " +
    "`report.url` is the download link. Every call creates a new file — use get_report_info for the last one.",
  {
    blog,
    type: reportType,
    from: unixTime.optional(),
    to: unixTime.optional(),
    period: z.string().optional().describe('Period name instead of from/to, e.g. "month"'),
    separator: z.string().optional().describe("Column separator of the file"),
  },
  ({ blog: blogName, type, ...options }) => api.stats.report(blogName, type, options),
  "write"
);

tool(
  "get_report_info",
  "The last built report of a type; `report` is null when there is none.",
  { blog, type: reportType },
  (args) => api.stats.reportInfo(args.blog, args.type)
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
    reply_limit: replyLimit,
    level_id: levelId.optional().describe("Only posts of this subscription level"),
    tags_ids: z.array(z.number().int()).optional().describe("Only posts with these tag ids"),
    from_ts: unixTime.optional().describe("Only posts published after this unix time (seconds)"),
    to_ts: unixTime.optional().describe("Only posts published before this unix time (seconds)"),
  },
  (args) =>
    api.posts.list(args.blog, {
      limit: args.limit ?? 10,
      offset: args.offset,
      commentsLimit: args.comments_limit,
      replyLimit: args.reply_limit,
      levelId: args.level_id,
      tagsIds: args.tags_ids?.join(","),
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

const price = z.number().int().min(0).describe("Access price in rubles; 0 — open to everyone");
const postFields = {
  teaser_text: z.string().optional().describe("Teaser shown to users without access"),
  price: price.optional(),
  tags: z.string().optional().describe("Comma-separated tags"),
  deny_comments: z.boolean().optional().describe("Close the comments"),
  publish_time: z.number().int().optional().describe("Unix time (seconds) to publish at; a new post without it is published now"),
};

tool(
  "create_post",
  "Publish a plain-text post in the user's own blog (line breaks become paragraphs). Experimental: the request " +
    "body is reconstructed from the web client.",
  { blog, title: z.string().min(1), text: z.string().min(1), ...postFields },
  (args) =>
    api.posts.create(args.blog, {
      title: args.title,
      data: textBlocks(args.text),
      teaser_data: args.teaser_text === undefined ? undefined : textBlocks(args.teaser_text),
      price: args.price ?? 0,
      tags: args.tags ?? "",
      deny_comments: args.deny_comments ?? false,
      wait_video: false,
      has_chat: false,
      publish_time: args.publish_time,
    }),
  "write"
);

tool(
  "update_post",
  "Edit a post of the user's own blog; omitted fields keep their current value. `text` replaces the WHOLE " +
    "body, media blocks included. Experimental: the request body is reconstructed from the web client.",
  { blog, post_id: postId, title: z.string().min(1).optional(), text: z.string().min(1).optional(), ...postFields },
  async (args) => {
    // Boosty takes the whole post on PUT, so the fields that are not being edited come from the current one
    const current = await api.posts.get(args.blog, args.post_id);
    return api.posts.update(args.blog, args.post_id, {
      title: args.title ?? current.title ?? "",
      data: args.text === undefined ? current.data : textBlocks(args.text),
      teaser_data: args.teaser_text === undefined ? current.teaser : textBlocks(args.teaser_text),
      price: args.price ?? current.price ?? 0,
      tags: args.tags ?? (current.tags ?? []).map((tag) => tag.title).join(","),
      deny_comments: args.deny_comments ?? current.isCommentsDenied ?? false,
      wait_video: false,
      publish_time: args.publish_time ?? current.publishTime,
      advertiser_info: current.advertiserInfo ?? undefined,
    });
  },
  "write"
);

tool(
  "get_post_deferred_access",
  "Deferred access settings of a post: the price and comment settings it switches to at `applyTime`.",
  { blog, post_id: postId },
  (args) => api.posts.getDeferredAccess(args.blog, args.post_id)
);

tool(
  "update_post_deferred_access",
  "Schedule a change of a post's access: at `apply_time` it gets the given price and comment settings.",
  {
    blog,
    post_id: postId,
    price,
    is_comments_denied: z.boolean(),
    apply_time: z.number().int().describe("Unix time (seconds) when the change applies"),
  },
  (args) =>
    api.posts.updateDeferredAccess(args.blog, args.post_id, {
      price: args.price,
      isCommentsDenied: args.is_comments_denied,
      applyTime: args.apply_time,
    }),
  "write"
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
    type: z.enum(["all", "image", "video", "audio"]).optional().describe("Media type, default all"),
    limit,
    offset,
  },
  (args) => api.media.list(args.blog, { type: args.type, ...page(args) })
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
  (args) => api.feed.searchBlogs(args.query, page(args))
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

tool(
  "react_to_post",
  "Put a reaction on a post (replaces the previous one). Experimental: the endpoint is reconstructed from the web client.",
  { blog, post_id: postId, reaction },
  (args) => api.social.reactToPost(args.blog, args.post_id, args.reaction),
  "write"
);

tool(
  "remove_post_reaction",
  "Remove the user's reaction from a post. Experimental: the endpoint is reconstructed from the web client.",
  { blog, post_id: postId },
  (args) => api.social.removePostReaction(args.blog, args.post_id),
  "write"
);

// ─── Search ─────────────────────────────────────────────

const searchPosts = {
  query: z.string().min(1),
  limit,
  offset,
  only_allowed: z.boolean().optional().describe("Only posts the user has access to"),
  from: unixTime.optional(),
  to: unixTime.optional(),
};

tool(
  "search_feed_posts",
  "Full-text search of posts across Boosty.",
  {
    ...searchPosts,
    only_bought: z.boolean().optional().describe("Only posts the user bought"),
    tag_ids: z.array(z.number().int()).optional().describe("Only posts with these feed tags (search_feed_tags)"),
  },
  ({ query, only_allowed, only_bought, tag_ids, ...options }) =>
    api.search.postsInFeed(query, { ...options, onlyAllowed: only_allowed, onlyBought: only_bought, tagIds: tag_ids })
);

tool(
  "search_blog_posts",
  "Full-text search of posts inside one blog, with filters by level and attached media.",
  {
    blog,
    ...searchPosts,
    level_ids: z.array(levelId).optional(),
    has_image: z.boolean().optional(),
    has_audio: z.boolean().optional(),
    has_audio_file: z.boolean().optional(),
    has_video: z.boolean().optional(),
    has_video_file: z.boolean().optional().describe("Video hosted by Boosty"),
    has_file: z.boolean().optional(),
  },
  (args) =>
    api.search.postsInBlog(args.blog, args.query, {
      ...page(args),
      onlyAllowed: args.only_allowed,
      from: args.from,
      to: args.to,
      subscriptionLevelIds: args.level_ids,
      hasImage: args.has_image,
      hasAudio: args.has_audio,
      hasAudioFile: args.has_audio_file,
      hasVideo: args.has_video,
      hasVideoFile: args.has_video_file,
      hasFile: args.has_file,
    })
);

tool(
  "suggest_blogs",
  "Blog suggestions for a partial name (autocomplete).",
  { query: z.string().min(1), limit, offset },
  (args) => api.search.blogSuggest(args.query, page(args))
);

tool("search_feed_tags", "Feed tags matching a query.", { query: z.string().min(1), limit, offset }, (args) =>
  api.search.feedTags(args.query, page(args))
);

// ─── Polls ──────────────────────────────────────────────

const pollId = z.number().int().describe("Poll id (`poll.id` of the post)");
const optionId = z.number().int().describe("Option id (`poll.options[].id`)");

tool(
  "get_poll",
  "A poll of a blog with its options and counters. Experimental: the endpoint is reconstructed from the web client.",
  { blog, poll_id: pollId, voters_limit: z.number().int().optional().describe("Voters to embed per option") },
  (args) => api.blog.poll(args.blog, args.poll_id, { votersLimit: args.voters_limit })
);

tool(
  "list_poll_voters",
  "Voters of a poll, or of one of its options. Experimental: the endpoint is reconstructed from the web client.",
  { blog, poll_id: pollId, option_id: optionId.optional(), limit, offset: skip },
  (args) => api.blog.pollVoters(args.blog, args.poll_id, { option: args.option_id, limit: args.limit, offset: args.offset })
);

tool(
  "vote_poll",
  "Vote in a post's poll with one or several options; replaces the user's earlier vote. Experimental: the " +
    "endpoint is reconstructed from the web client.",
  {
    poll_id: pollId,
    option_ids: z.array(optionId).min(1),
    other: z.string().optional().describe('Free-text answer for polls with an "other" option'),
    is_anonymous: z.boolean().optional(),
  },
  (args) => api.social.vote(args.poll_id, args.option_ids, { other: args.other, isAnonymous: args.is_anonymous }),
  "write"
);

tool(
  "unvote_poll",
  "Withdraw the user's whole vote from a post's poll. Experimental: the endpoint is reconstructed from the web client.",
  { poll_id: pollId },
  // The blog argument is unused by boosty-api: the endpoint does not take it
  (args) => api.social.removeVote("", args.poll_id),
  "write"
);

// ─── Comments ───────────────────────────────────────────

const commentId = z.number().int().describe("`intId` of the comment");

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
  { blog, post_id: postId, comment_id: commentId, limit, offset },
  (args) => api.comments.replies(args.blog, args.post_id, args.comment_id, page(args))
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

tool(
  "like_comment",
  "Like a comment. Experimental: the endpoint is reconstructed from the web client.",
  { blog, post_id: postId, comment_id: commentId },
  (args) => api.comments.like(args.blog, args.post_id, args.comment_id),
  "write"
);

tool(
  "unlike_comment",
  "Remove the like from a comment. Experimental: the endpoint is reconstructed from the web client.",
  { blog, post_id: postId, comment_id: commentId },
  (args) => api.comments.unlike(args.blog, args.post_id, args.comment_id),
  "write"
);

tool(
  "react_to_comment",
  "Put a reaction on a comment (replaces the previous one). Experimental: the endpoint is reconstructed from the web client.",
  { blog, post_id: postId, comment_id: commentId, reaction },
  (args) => api.comments.react(args.blog, args.post_id, args.comment_id, args.reaction),
  "write"
);

tool(
  "remove_comment_reaction",
  "Remove the user's reaction from a comment. Experimental: the endpoint is reconstructed from the web client.",
  { blog, post_id: postId, comment_id: commentId },
  (args) => api.comments.removeReaction(args.blog, args.post_id, args.comment_id),
  "write"
);

// ─── Messages ───────────────────────────────────────────

const dialogId = z.number().int().describe("Dialog id (from list_dialogs / get_dialog_with_user)");

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
  api.messaging.messages(args.dialog_id, page(args))
);

tool(
  "send_message",
  "Send a plain-text direct message into a dialog.",
  { dialog_id: dialogId, text: z.string().min(1) },
  (args) => api.messaging.sendMessage(args.dialog_id, [textBlock(args.text)]),
  "write"
);

// ─── Notifications ──────────────────────────────────────

const eventId = z.number().int().describe("Notification id (`events[].id` of list_notifications)");
const eventIds = z.array(eventId).min(1);

tool(
  "list_notifications",
  "Notification feed of the logged-in user (the bell): new subscribers, donations etc., with unread counters.",
  {},
  () => api.messaging.notifications()
);

tool(
  "mark_notifications_read",
  "Mark notifications as read. Returns the feed with updated counters.",
  { event_ids: eventIds },
  (args) => api.messaging.markNotificationsRead(args.event_ids),
  "write"
);

tool(
  "delete_notification",
  "Delete one notification. Experimental: the endpoint is reconstructed from the web client.",
  { event_id: eventId },
  (args) => api.messaging.deleteNotification(args.event_id),
  "destructive"
);

tool(
  "delete_notifications",
  "Delete several notifications at once. Experimental: the endpoint is reconstructed from the web client.",
  { event_ids: eventIds },
  (args) => api.messaging.deleteNotifications(args.event_ids),
  "destructive"
);

await server.connect(new StdioServerTransport());
console.error(`Boosty MCP server started (${api.auth.isAuthenticated ? "logged in" : "anonymous — call `login`"})`);
