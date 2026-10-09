/** Account and its settings: login, sessions, notifications, profile. */

import { type NotificationSwitch, type NotificationTransport } from "boosty-api";
import { z } from "zod";
import { limit, skip, levelId } from "../schemas.js";
import { api, login, server, textResult, tool } from "../server.js";

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
