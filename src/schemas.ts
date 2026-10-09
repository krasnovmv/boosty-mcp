/** Tool arguments shared by several tool groups. */

import { z } from "zod";

// Both go into URL paths; "." and ".." would climb out of /v1/blog/<name>/ (boosty-api rejects them too)
export const blog = z
  .string()
  .regex(/^(?!\.+$)[\w.-]+$/)
  .describe("Blog name from its URL: boosty.to/<blog>");
export const postId = z
  .string()
  .regex(/^[\w-]+$/)
  .describe("Post id (UUID from the post URL)");
export const limit = z.number().int().positive().optional().describe("Max items per page");
export const replyLimit = z.number().int().optional().describe("Replies to embed per comment");
export const offset = z
  .string()
  .optional()
  .describe("Pagination cursor: `extra.offset` (or `offset`) of the previous page");
export const skip = z.number().int().min(0).optional().describe("Items to skip");
export const unixTime = z.number().int().describe("Unix time, seconds");
export const order = z.enum(["gt", "lt"]).optional().describe("Sort direction: gt — descending, lt — ascending");
export const levelId = z.number().int().describe("Subscription level id (list_subscription_levels)");
export const userId = z.number().int().describe("Boosty user id");
export const reaction = z
  .string()
  .min(1)
  .describe('Reaction name: "like", "dislike", "heart", "fire", "laugh", "wonder", "sad", "angry", …');

/** The `limit` / `offset` pair of a tool as boosty-api list options. */
export const page = (args: { limit?: number; offset?: string }) => ({ limit: args.limit, offset: args.offset });
