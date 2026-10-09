/** Comments of posts. */

import { textBlock } from "boosty-api";
import { z } from "zod";
import { blog, postId, limit, replyLimit, offset, reaction, page } from "../schemas.js";
import { api, tool } from "../server.js";

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
