/** Posts: reading, writing, media, the feed, likes and reactions. */

import { z } from "zod";
import { blog, postId, limit, replyLimit, offset, unixTime, levelId, reaction, page } from "../schemas.js";
import { api, tool } from "../server.js";
import { textBlocks } from "../slim.js";

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
