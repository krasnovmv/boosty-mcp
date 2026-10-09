/** Income of a blog: donations, sales, holds, payouts. */

import { z } from "zod";
import { blog, postId, limit, offset, unixTime, order, page } from "../schemas.js";
import { api, tool } from "../server.js";

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
