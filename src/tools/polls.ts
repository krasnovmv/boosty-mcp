/** Polls attached to posts. */

import { z } from "zod";
import { blog, limit, skip } from "../schemas.js";
import { api, tool } from "../server.js";

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
  (args) =>
    api.blog.pollVoters(args.blog, args.poll_id, { option: args.option_id, limit: args.limit, offset: args.offset })
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
