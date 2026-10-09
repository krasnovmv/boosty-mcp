/** Creator dashboard statistics. */

import { z } from "zod";
import { blog, postId, limit, offset, unixTime, order, userId, page } from "../schemas.js";
import { api, tool } from "../server.js";

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
