export class LatelyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const TIMEOUT_MS = 8000;

const API = {
  spotifyAccounts: "https://accounts.spotify.com",
  spotifyApi: "https://api.spotify.com",
  steam: "https://api.steampowered.com",
  steamMedia: "https://media.steampowered.com",
  openMeteo: "https://api.open-meteo.com",
};

const setting = (env, name) => (typeof env[name] === "string" ? env[name].trim() : "");

export const request = async (url, init = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, headers: { "User-Agent": "hxrry.dev", ...(init.headers || {}) } });
  } catch (error) {
    throw new LatelyError("upstream", error.name === "AbortError" ? "timed out" : "network error");
  } finally {
    clearTimeout(timer);
  }
};

export const clean = (value, max = 200) => {
  if (typeof value !== "string") return "";
  const s = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

const httpsOn = (value, hosts) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && hosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h)) ? u.href : "";
  } catch {
    return "";
  }
};

export const IMAGE_HOSTS = ["scdn.co", "spotifycdn.com", "steampowered.com", "steamstatic.com", "akamaihd.net"];
export const imageAllowed = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && IMAGE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  } catch {
    return false;
  }
};

const isoOrNull = (value) => {
  const t = Date.parse(value);
  return Number.isFinite(t) && t <= Date.now() + 60000 ? new Date(t).toISOString() : null;
};

let spotifyToken = { value: "", expires: 0, forRefresh: "" };

const spotifyAccessToken = async (env) => {
  const id = setting(env, "SPOTIFY_CLIENT_ID"), secret = setting(env, "SPOTIFY_CLIENT_SECRET"), refresh = setting(env, "SPOTIFY_REFRESH_TOKEN");
  if (!id || !secret || !refresh) throw new LatelyError("unconfigured", "Spotify credentials aren't set");
  if (spotifyToken.value && spotifyToken.forRefresh === refresh && Date.now() < spotifyToken.expires - 60000) return spotifyToken.value;
  const res = await request(`${API.spotifyAccounts}/api/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${id}:${secret}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new LatelyError(res.status === 400 || res.status === 401 ? "auth" : "upstream",
      res.status === 400 || res.status === 401 ? "Spotify refused the refresh token (they expire after 6 months; run npm run spotify-auth)" : `Spotify token request failed (${res.status})`);
  }
  if (typeof body.access_token !== "string") throw new LatelyError("upstream", "Spotify token response was malformed");
  const seconds = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
  spotifyToken = { value: body.access_token, expires: Date.now() + seconds * 1000, forRefresh: refresh };
  return spotifyToken.value;
};

const fromTrack = (track) => {
  if (!track || track.type !== "track") return null;
  const title = clean(track.name);
  if (!title) return null;
  const artist = clean((Array.isArray(track.artists) ? track.artists : []).map((a) => a && a.name).filter(Boolean).join(", "));
  const images = (track.album && Array.isArray(track.album.images) ? track.album.images : []).filter((i) => i && typeof i.url === "string");
  images.sort((a, b) => (a.width || 0) - (b.width || 0));
  const image = images.find((i) => (i.width || 0) >= 64) || images[images.length - 1];
  return {
    title, subtitle: artist,
    url: httpsOn(track.external_urls && track.external_urls.spotify, ["open.spotify.com"]),
    imageUrl: image ? image.url : "",
  };
};

export const spotify = async (env) => {
  const token = await spotifyAccessToken(env);
  const api = (path) => request(`${API.spotifyApi}/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const authFail = (res) => res.status === 401 || res.status === 403;

  const now = await api("/me/player/currently-playing");
  if (authFail(now)) throw new LatelyError("auth", `Spotify said ${now.status} (scopes, User Management, or the app owner's Premium)`);
  let paused = null;
  if (now.status === 200) {
    const body = await now.json().catch(() => null);
    const item = body ? fromTrack(body.item) : null;
    if (item && body.is_playing) return { state: "playing", item: { ...item, at: new Date().toISOString() } };
    const changed = Number(body && body.timestamp);
    if (item) paused = { ...item, at: Number.isFinite(changed) && changed > 0 ? isoOrNull(new Date(changed).toISOString()) : null };
  } else if (now.status !== 204) {
    throw new LatelyError("upstream", `Spotify currently-playing failed (${now.status})`);
  }

  const recent = await api("/me/player/recently-played?limit=1");
  if (authFail(recent)) throw new LatelyError("auth", `Spotify said ${recent.status}`);
  if (!recent.ok) throw new LatelyError("upstream", `Spotify recently-played failed (${recent.status})`);
  const body = await recent.json().catch(() => null);
  if (!body || !Array.isArray(body.items)) throw new LatelyError("upstream", "Spotify recently-played was malformed");
  const first = body.items[0];
  const last = first ? fromTrack(first.track) : null;
  if (first && !last) throw new LatelyError("upstream", "Spotify returned a track without a name");
  const lastAt = first ? isoOrNull(first.played_at) : null;

  if (paused && (!last || !lastAt || (paused.at && Date.parse(paused.at) >= Date.parse(lastAt)))) {
    return { state: "recent", item: paused };
  }
  if (!last) return { state: null, item: null };
  return { state: "recent", item: { ...last, at: lastAt } };
};

export const steam = async (env) => {
  const key = setting(env, "STEAM_API_KEY"), id = setting(env, "STEAM_ID");
  if (!key || !id) throw new LatelyError("unconfigured", "STEAM_API_KEY and STEAM_ID aren't both set");
  if (!/^\d{17}$/.test(id)) throw new LatelyError("unconfigured", "STEAM_ID should be a 17-digit SteamID64");
  const res = await request(`${API.steam}/IPlayerService/GetRecentlyPlayedGames/v1/?key=${encodeURIComponent(key)}&steamid=${id}&count=0&format=json`);
  if (res.status === 401 || res.status === 403) throw new LatelyError("auth", `Steam refused the API key (${res.status})`);
  if (!res.ok) throw new LatelyError("upstream", `Steam request failed (${res.status})`);
  const body = await res.json().catch(() => null);
  if (!body || typeof body.response !== "object" || body.response === null) throw new LatelyError("upstream", "Steam response was malformed");
  const games = (Array.isArray(body.response.games) ? body.response.games : []).filter((g) => g && Number.isInteger(Number(g.appid)));
  if (!games.length) return { state: null, item: null };

  let game = games[0];
  let lastPlayed = null;
  try {
    const params = new URLSearchParams({ key, steamid: id, include_played_free_games: "1", format: "json" });
    games.slice(0, 20).forEach((g, i) => params.append(`appids_filter[${i}]`, String(Number(g.appid))));
    const owned = await request(`${API.steam}/IPlayerService/GetOwnedGames/v1/?${params}`);
    const ownedBody = owned.ok ? await owned.json().catch(() => null) : null;
    const times = new Map((ownedBody && ownedBody.response && Array.isArray(ownedBody.response.games) ? ownedBody.response.games : [])
      .filter((g) => g && Number(g.rtime_last_played) > 0).map((g) => [Number(g.appid), Number(g.rtime_last_played)]));
    const latest = games.filter((g) => times.has(Number(g.appid))).sort((a, b) => times.get(Number(b.appid)) - times.get(Number(a.appid)))[0];
    if (latest) {
      game = latest;
      lastPlayed = isoOrNull(new Date(times.get(Number(latest.appid)) * 1000).toISOString());
    }
  } catch {

  }
  const appid = Number(game.appid);
  const name = clean(game.name);
  if (!Number.isInteger(appid) || appid <= 0 || !name) throw new LatelyError("upstream", "Steam returned a game without a name or id");
  const minutes = Number(game.playtime_2weeks);
  const icon = typeof game.img_icon_url === "string" && /^[0-9a-f]{40}$/.test(game.img_icon_url)
    ? `${API.steamMedia}/steamcommunity/public/images/apps/${appid}/${game.img_icon_url}.jpg` : "";
  return {
    state: "recent",
    item: { title: name, subtitle: "", url: `https://store.steampowered.com/app/${appid}/`, imageUrl: icon, at: lastPlayed, minutes2weeks: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0 },
  };
};

const CONDITIONS = [
  [[0], "clear", "sun", "moon"],
  [[1], "mostly clear", "cloud-sun", "cloud-moon"],
  [[2], "partly cloudy", "cloud-sun", "cloud-moon"],
  [[3], "cloudy", "cloud"],
  [[45, 48], "foggy", "cloud-fog"],
  [[51, 53, 55], "drizzle", "cloud-drizzle"],
  [[56, 57], "freezing drizzle", "cloud-drizzle"],
  [[61, 63, 65], "rain", "cloud-rain"],
  [[66, 67], "freezing rain", "cloud-rain"],
  [[80, 81, 82], "showers", "cloud-rain"],
  [[71, 73, 75, 77], "snow", "cloud-snow"],
  [[85, 86], "snow showers", "cloud-snow"],
  [[95, 96, 99], "thunderstorms", "cloud-lightning"],
];

export const weather = async (env) => {
  const where = setting(env, "WEATHER_LOCATION").match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  const lat = where ? Number(where[1]) : NaN, lon = where ? Number(where[2]) : NaN;
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new LatelyError("unconfigured", "WEATHER_LOCATION should be latitude,longitude");
  const params = new URLSearchParams({ latitude: lat.toFixed(2), longitude: lon.toFixed(2), current: "temperature_2m,weather_code,is_day" });
  const res = await request(`${API.openMeteo}/v1/forecast?${params}`);
  if (!res.ok) throw new LatelyError("upstream", `Open-Meteo request failed (${res.status})`);
  const body = await res.json().catch(() => null);
  const now = body && body.current;
  const temp = now && typeof now.temperature_2m === "number" ? now.temperature_2m : NaN;
  const kind = now && CONDITIONS.find(([codes]) => codes.includes(now.weather_code));
  if (!Number.isFinite(temp) || !kind) throw new LatelyError("upstream", "Open-Meteo response was malformed");
  const [, condition, dayIcon, nightIcon] = kind;
  return { state: "current", item: { temperature: Math.round(temp) || 0, condition, icon: now.is_day === 0 && nightIcon ? nightIcon : dayIcon } };
};

export const SOURCES = {
  listening: { fetch: spotify, service: "spotify", ttl: 30, keep: 14 * 86400 },
  playing: { fetch: steam, service: "steam", ttl: 10 * 60, keep: 14 * 86400 },
  weather: { fetch: weather, service: "open-meteo", ttl: 30 * 60, keep: 0,
    show: ({ temperature, condition, icon }) => ({ temperature, condition, icon }) },
};

export const scrub = (message, env) =>
  ["SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN", "STEAM_API_KEY", "WEATHER_LOCATION"].map((k) => setting(env, k)).filter(Boolean)
    .reduce((m, s) => m.split(s).join("[hidden]"), String(message));
