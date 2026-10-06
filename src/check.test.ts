import assert from "node:assert/strict";
import { test } from "node:test";
import { textBlock } from "boosty-api";
import { tokensFromCookies } from "./auth.js";
import { slim } from "./slim.js";

test("tokensFromCookies: signed-in boosty.to cookies give auth.json fields", () => {
  const auth = encodeURIComponent(JSON.stringify({ accessToken: "a", refreshToken: "r", expiresAt: 1790000000000 }));
  const cookies = [
    { name: "auth", value: auth, domain: ".boosty.to" },
    { name: "_clientId", value: "device", domain: "boosty.to" },
    { name: "auth", value: "other", domain: "notboosty.to" },
  ];
  assert.deepEqual(tokensFromCookies(cookies), {
    access_token: "a",
    refresh_token: "r",
    expires_at: "1790000000000",
    device_id: "device",
  });
});

test("tokensFromCookies: guest cookies give null", () => {
  assert.equal(tokensFromCookies([{ name: "_clientId", value: "device", domain: ".boosty.to" }]), null);
  const guestAuth = encodeURIComponent(JSON.stringify({}));
  assert.equal(
    tokensFromCookies([
      { name: "auth", value: guestAuth, domain: ".boosty.to" },
      { name: "_clientId", value: "device", domain: ".boosty.to" },
    ]),
    null
  );
});

test("slim: text blocks become `text`, media blocks stay", () => {
  const image = { type: "image", url: "https://example.com/1.jpg" };
  const paragraphEnd = { type: "text", content: "", modificator: "BLOCK_END" };
  const link = { type: "link", content: JSON.stringify(["site", "unstyled", []]), url: "https://example.com" };
  const post = {
    id: "p",
    data: [textBlock("Hello"), paragraphEnd, textBlock("See "), link, paragraphEnd, image],
    comments: { data: [{ id: "c", data: [textBlock("Hi")] }] },
  };
  assert.deepEqual(slim({ data: [post] }), {
    data: [
      {
        id: "p",
        text: "Hello\nSee site (https://example.com)",
        data: [image],
        comments: { data: [{ id: "c", text: "Hi", data: [] }] },
      },
    ],
  });
});
