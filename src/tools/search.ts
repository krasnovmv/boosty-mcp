/** Search of blogs, posts and tags. */

import { z } from "zod";
import { blog, limit, offset, unixTime, levelId, page } from "../schemas.js";
import { api, tool } from "../server.js";

const searchPosts = {
  query: z.string().min(1),
  limit,
  offset,
  only_allowed: z.boolean().optional().describe("Only posts the user has access to"),
  from: unixTime.optional(),
  to: unixTime.optional(),
};

tool("search_blogs", "Search Boosty blogs by name (requires login).", { query: z.string(), limit, offset }, (args) =>
  api.feed.searchBlogs(args.query, page(args))
);

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
