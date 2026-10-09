/** Blog profile, subscription levels, subscribers and goals. */

import { z } from "zod";
import { blog, limit, offset, unixTime, order, levelId } from "../schemas.js";
import { api, tool } from "../server.js";

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

// ─── Goals ───

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
