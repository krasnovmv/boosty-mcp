/** Direct messages and notifications. */

import { textBlock } from "boosty-api";
import { z } from "zod";
import { limit, offset, userId, page } from "../schemas.js";
import { api, tool } from "../server.js";

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

// ─── Notifications ───

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
