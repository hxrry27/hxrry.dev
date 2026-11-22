import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".dev.vars");
const PORT = 8888;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = "user-read-currently-playing user-read-recently-played";

const envText = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const read = (name) => (process.env[name] || (envText.match(new RegExp(`^${name}=(.*)$`, "m")) || [])[1] || "").trim().replace(/^["']|["']$/g, "");
const clientId = read("SPOTIFY_CLIENT_ID"), clientSecret = read("SPOTIFY_CLIENT_SECRET");
if (!clientId || !clientSecret) {
  console.error("Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .dev.vars");
  process.exit(1);
}

const state = randomBytes(16).toString("hex");
const authUrl = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
  response_type: "code", client_id: clientId, scope: SCOPES, redirect_uri: REDIRECT, state,
});

const saveToken = (token) => {
  const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const line = `SPOTIFY_REFRESH_TOKEN=${token}`;
  const next = /^SPOTIFY_REFRESH_TOKEN=.*$/m.test(current)
    ? current.replace(/^SPOTIFY_REFRESH_TOKEN=.*$/m, line)
    : current.replace(/\n?$/, "\n") + line + "\n";
  writeFileSync(envFile, next);
};

const page = (res, status, text) => {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><title>hxrry.dev · spotify</title><body style="font-family:system-ui;padding:2rem"><p>${text}</p></body>`);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== "/callback") return page(res, 404, "not found");
  if (url.searchParams.get("state") !== state) return page(res, 400, "That didn't match this login attempt. Run npm run spotify-auth again.");
  if (url.searchParams.get("error")) {
    page(res, 400, "Spotify said no (you may have cancelled). Nothing was saved.");
    console.error(`Spotify returned: ${url.searchParams.get("error")}`);
    return server.close();
  }
  try {
    const r = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: url.searchParams.get("code") || "", redirect_uri: REDIRECT }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || typeof body.refresh_token !== "string") throw new Error(`token exchange failed (${r.status}${body.error ? ", " + body.error : ""})`);
    saveToken(body.refresh_token);
    page(res, 200, "Done. The refresh token is saved in .dev.vars. You can close this tab.");
    console.log("Saved SPOTIFY_REFRESH_TOKEN to .dev.vars. Check it with: npm run dev");
  } catch (error) {
    page(res, 500, "Something went wrong swapping the code for a token. Check the terminal.");
    console.error(error.message);
  }
  server.close();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Open this link, log in to Spotify and approve:\n\n  ${authUrl}\n`);
  console.log(`(The app's redirect URI in the Spotify dashboard must be exactly ${REDIRECT})`);
});
