/**
 * Boosty login: opens a Chromium-based browser with a kept profile, waits until the
 * user signs in and closes it, then reads the tokens through the DevTools protocol
 * (no extra dependencies) from the `auth` / `_clientId` cookies of boosty.to and saves
 * them in the auth.json format of boosty-api (~/.config/boosty-mcp/auth.json, chmod 600).
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CONFIG_DIR = join(homedir(), ".config", "boosty-mcp");
export const AUTH_FILE = join(CONFIG_DIR, "auth.json");
const PROFILE_DIR = join(CONFIG_DIR, "chrome-profile");

const LOGIN_URL = "https://boosty.to";
const LOGIN_TIMEOUT_MS = 5 * 60_000;

/** Chromium-based browsers share the DevTools protocol, so any of them works. */
const BROWSER_CANDIDATES = [
  // macOS
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Yandex.app/Contents/MacOS/Yandex",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  // Linux
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/microsoft-edge",
  "/usr/bin/yandex-browser",
  "/usr/bin/brave-browser",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  // Windows (per-machine and per-user installs)
  ...["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"].flatMap((variable) => {
    const root = process.env[variable];
    return root
      ? [
          `${root}\\Google\\Chrome\\Application\\chrome.exe`,
          `${root}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${root}\\Yandex\\YandexBrowser\\Application\\browser.exe`,
          `${root}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        ]
      : [];
  }),
];

interface AuthJson {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  device_id: string;
  user_agent?: string;
}

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
}

function isBoostyCookie(cookie: Cookie): boolean {
  return /(^|\.)boosty\.to$/.test(cookie.domain);
}

/** The Boosty session cookie: read at login, then removed from the kept profile. */
function isAuthCookie(cookie: Cookie): boolean {
  return cookie.name === "auth" && isBoostyCookie(cookie);
}

/**
 * Tokens from the boosty.to cookies, or null while the user is not signed in.
 * `auth` is URL-encoded JSON { accessToken, refreshToken, expiresAt }, `_clientId` is the device id
 * (required for token refresh).
 */
export function tokensFromCookies(cookies: Cookie[]): Omit<AuthJson, "user_agent"> | null {
  const authCookie = cookies.find(isAuthCookie);
  const deviceId = cookies.find((cookie) => cookie.name === "_clientId" && isBoostyCookie(cookie))?.value;
  if (!authCookie || !deviceId) return null;
  try {
    const auth = JSON.parse(decodeURIComponent(authCookie.value));
    if (!auth.accessToken || !auth.refreshToken) return null;
    return {
      access_token: auth.accessToken,
      refresh_token: auth.refreshToken,
      expires_at: String(auth.expiresAt ?? ""),
      device_id: deviceId,
    };
  } catch {
    return null;
  }
}

function saveAuth(auth: AuthJson): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
  // writeFileSync keeps the old mode of an existing file
  chmodSync(AUTH_FILE, 0o600);
}

/**
 * Open a browser window, wait until the user signs in to Boosty and closes it, save the tokens.
 * The profile is kept between logins, so the Google (VK, …) session survives and the next login
 * is one click. The window runs without a DevTools port: Google refuses to sign in to a browser
 * that has one. The cookies are read afterwards by a headless run of the same profile.
 */
export async function browserLogin(): Promise<void> {
  const browserPath = [process.env.BOOSTY_CHROME_PATH, ...BROWSER_CANDIDATES].find(
    (candidate) => candidate && existsSync(candidate)
  );
  if (!browserPath) {
    throw new Error(
      "No Chromium-based browser found (Chrome, Edge, Yandex Browser, Brave, Chromium). " +
        "Install one or set BOOSTY_CHROME_PATH."
    );
  }
  if (typeof WebSocket === "undefined") throw new Error("Login needs Node.js >= 22 (global WebSocket)");

  mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
  const browserArguments = [`--user-data-dir=${PROFILE_DIR}`, "--no-first-run", "--no-default-browser-check"];

  const loginProcess = spawn(browserPath, [...browserArguments, LOGIN_URL], { stdio: "ignore" });
  // Unref'd timer: it must not keep the server alive once the window is closed
  await Promise.race([once(loginProcess, "exit"), sleep(LOGIN_TIMEOUT_MS, undefined, { ref: false })]);
  if (loginProcess.exitCode === null) loginProcess.kill();
  // The profile lock is released a moment after the browser exits
  await sleep(500);

  // A stale port file from an earlier run would be mistaken for the new one
  const portFile = join(PROFILE_DIR, "DevToolsActivePort");
  writeFileSync(portFile, "");
  // about:blank: the Boosty page itself must not load here and rotate the refresh token
  const browserProcess = spawn(
    browserPath,
    [...browserArguments, "--headless=new", "--remote-debugging-port=0", "about:blank"],
    { stdio: "ignore" }
  );
  let socket: WebSocket | undefined;
  try {
    // With port 0 the browser writes the chosen port and the browser endpoint path into the profile
    let endpoint = "";
    for (let attempt = 0; attempt < 100 && !endpoint; attempt++) {
      if (browserProcess.exitCode !== null) throw new Error("Browser exited right after start");
      const [port, path] = readFileSync(portFile, "utf8").split("\n");
      if (port && path) endpoint = `ws://127.0.0.1:${port.trim()}${path.trim()}`;
      else await sleep(200);
    }
    if (!endpoint) throw new Error("Browser did not open a DevTools port");

    const connection = new WebSocket(endpoint);
    socket = connection;
    const pendingCalls = new Map<number, (message: any) => void>();
    connection.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      pendingCalls.get(message.id)?.(message);
      pendingCalls.delete(message.id);
    });
    connection.addEventListener("close", () => {
      for (const resolvePending of pendingCalls.values()) resolvePending({ error: { message: "browser closed" } });
    });
    await new Promise<void>((resolve, reject) => {
      connection.addEventListener("open", () => resolve(), { once: true });
      connection.addEventListener("error", () => reject(new Error("DevTools connection failed")), { once: true });
    });
    let nextMessageId = 1;
    const send = async (method: string, params: object = {}): Promise<any> => {
      const messageId = nextMessageId++;
      const message = await new Promise<any>((resolve) => {
        pendingCalls.set(messageId, resolve);
        connection.send(JSON.stringify({ id: messageId, method, params }));
      });
      if (message.error) throw new Error(`${method}: ${message.error.message}`);
      return message.result;
    };

    const cookies: Cookie[] = (await send("Storage.getCookies")).cookies;
    const tokens = tokensFromCookies(cookies);
    if (!tokens) {
      await send("Browser.close").catch(() => undefined);
      throw new Error("Not signed in: the browser window was closed (or timed out) before the Boosty login finished");
    }
    // Same User-Agent as the browser that received the tokens: the visible one, not this headless run
    const { userAgent } = await send("Browser.getVersion");
    const auth = { ...tokens, user_agent: userAgent.replace("HeadlessChrome", "Chrome") };
    saveAuth(auth);
    // The kept profile must not hold the Boosty session: it would share (and race for) the
    // rotating refresh token with this server. An expired cookie replaces and so deletes it.
    await send("Storage.setCookies", {
      cookies: cookies
        .filter(isAuthCookie)
        .map(({ name, domain, path, secure }) => ({ name, value: "", domain, path, secure, expires: 1 })),
    });
    // Graceful shutdown writes the cookie change to disk; the connection drops as the browser exits
    await send("Browser.close").catch(() => undefined);
  } finally {
    socket?.close();
    await sleep(500);
    if (browserProcess.exitCode === null) browserProcess.kill();
  }
}
