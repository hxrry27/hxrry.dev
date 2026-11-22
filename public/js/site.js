const root = document.documentElement;

const toggle = document.querySelector(".theme-toggle");

if (toggle) {
  const updateLabel = () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    toggle.setAttribute("aria-label", `Switch to ${next} theme`);
  };

  const setTheme = (theme) => {
    root.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch (e) {
    }
    updateLabel();
  };

  toggle.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!document.startViewTransition || reduceMotion) {
      setTheme(next);
      return;
    }

    const box = toggle.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    const transition = document.startViewTransition(() => setTheme(next));
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 450, easing: "ease-out", pseudoElement: "::view-transition-new(root)" }
      );
    });
  });

  updateLabel();
  toggle.hidden = false;
}

const copyButton = document.querySelector(".copy-button");
const copyStatus = document.getElementById("copy-status");

const COPY_SOUNDS = true;

const sounds = {
  copied: { wave: "sine", notes: [
    { freq: 880, start: 0, length: 0.09, volume: 0.05 },
    { freq: 1320, start: 0.07, length: 0.14, volume: 0.04 },
  ] },

  failed: { wave: "triangle", notes: [
    { freq: 330, start: 0, length: 0.1, volume: 0.07 },
    { freq: 247, start: 0.09, length: 0.16, volume: 0.07 },
  ] },
};

let audioContext;

const wakeAudio = () => {
  if (!COPY_SOUNDS) return null;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    audioContext ||= new Context();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    return audioContext;
  } catch (e) {
    return null;
  }
};

const playSound = (audio, name) => {
  if (!audio) return;
  try {
    const { wave, notes } = sounds[name];
    const now = audio.currentTime;
    for (const { freq, start, length, volume } of notes) {
      const tone = audio.createOscillator();
      const fade = audio.createGain();
      tone.type = wave;
      tone.frequency.value = freq;

      fade.gain.setValueAtTime(0.0001, now + start);
      fade.gain.exponentialRampToValueAtTime(volume, now + start + 0.01);
      fade.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
      tone.connect(fade).connect(audio.destination);
      tone.start(now + start);
      tone.stop(now + start + length + 0.02);
    }
  } catch (e) {
  }
};

if (copyButton && navigator.clipboard) {
  const copyText = copyButton.querySelector(".copy-text");
  let resetTimer;

  const show = (state, label, announcement) => {
    copyButton.classList.remove("copied", "failed");
    copyButton.classList.add(state);
    copyText.textContent = label;
    if (copyStatus) copyStatus.textContent = announcement;

    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copyButton.classList.remove("copied", "failed");
      copyText.textContent = "copy";
      if (copyStatus) copyStatus.textContent = "";
    }, 2000);
  };

  copyButton.addEventListener("click", async () => {
    const audio = wakeAudio();
    try {
      await navigator.clipboard.writeText(copyButton.dataset.copy);
      show("copied", "copied", "email address copied");
      playSound(audio, "copied");
    } catch (e) {
      show("failed", "couldn't copy", "couldn't copy the email address");
      playSound(audio, "failed");
    }
  });

  copyButton.hidden = false;
}

const clock = document.querySelector(".clock");

if (clock) {
  const timeZone = clock.dataset.timezone;
  const timeEl = clock.querySelector(".clock-time");
  const hoursEl = clock.querySelector(".clock-h");
  const minutesEl = clock.querySelector(".clock-m");
  const colonEl = clock.querySelector(".clock-colon");
  const zoneEl = clock.querySelector(".clock-zone");
  const diffEl = clock.querySelector(".clock-diff");

  const timeFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });

  const offsetFormat = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "longOffset" });

  const part = (format, date, type) => format.formatToParts(date).find((p) => p.type === type).value;

  const toMinutes = (raw) => {
    const m = raw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    const minutes = Number(m[2]) * 60 + Number(m[3] || 0);
    return m[1] === "-" ? -minutes : minutes;
  };

  const formatGap = (minutes) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return [h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ");
  };

  const ukZoneNames = { 0: "GMT", 60: "BST" };

  const update = () => {
    const now = new Date();
    const mine = toMinutes(part(offsetFormat, now, "timeZoneName"));
    const theirs = -now.getTimezoneOffset();
    const diff = mine - theirs;

    hoursEl.textContent = part(timeFormat, now, "hour");
    minutesEl.textContent = part(timeFormat, now, "minute");
    timeEl.dateTime = now.toISOString();
    zoneEl.textContent = (timeZone === "Europe/London" && ukZoneNames[mine]) || "";

    const words = diff === 0 ? "same time" : `${formatGap(Math.abs(diff))} ${diff > 0 ? "ahead" : "behind"}`;
    const slashes = Object.assign(document.createElement("span"), { textContent: "// " });
    slashes.setAttribute("aria-hidden", "true");
    const context = Object.assign(document.createElement("span"), {
      className: "visually-hidden",
      textContent: diff === 0 ? " as you" : diff > 0 ? " of you" : " you",
    });
    diffEl.replaceChildren(slashes, words, context);
  };

  const scheduleNext = () => {
    setTimeout(() => {
      update();
      scheduleNext();
    }, 60000 - (Date.now() % 60000) + 50);
  };

  colonEl.style.animationDelay = `-${Date.now() % 1000}ms`;

  update();
  scheduleNext();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) update();
  });
  clock.hidden = false;
}

const weatherRow = document.querySelector(".weather");

if (weatherRow && window.fetch) {
  const WEATHER_ICONS = ["sun", "moon", "cloud", "cloud-sun", "cloud-moon", "cloud-fog", "cloud-drizzle", "cloud-rain", "cloud-snow", "cloud-lightning"];
  const weatherText = weatherRow.querySelector(".weather-text");
  const weatherIcon = weatherRow.querySelector("use");
  weatherRow.hidden = false;
  fetch("/api/weather", { headers: { Accept: "application/json" } })
    .then((res) => res.json())
    .then((data) => {
      if (data && data.status === "unconfigured") {
        weatherRow.hidden = true;
        return;
      }
      const item = data && data.item;
      if (!item || !Number.isFinite(item.temperature) || typeof item.condition !== "string") throw new Error("no weather");
      if (WEATHER_ICONS.includes(item.icon)) weatherIcon.setAttribute("href", weatherIcon.getAttribute("href").replace(/#.*$/, "#" + item.icon));
      const dot = document.createElement("span");
      dot.textContent = " · ";
      dot.setAttribute("aria-hidden", "true");
      weatherText.replaceChildren(item.temperature + "°C", dot, item.condition);
      weatherRow.dataset.ready = "";
    })
    .catch(() => {
      weatherText.textContent = "unavailable right now";
    });
}

const STATUS = "online";

const statusEl = document.querySelector(".status");

const statusWords = {
  online: { shown: "online" },
  away: { shown: "away" },
  dnd: { shown: "dnd", spoken: "do not disturb" },
  offline: { shown: "offline" },
};

const showStatus = (state) => {
  const words = statusWords[state];
  if (!statusEl || !words) return;
  statusEl.dataset.status = state;

  const text = statusEl.querySelector(".status-text");
  if (words.spoken) {
    const shown = Object.assign(document.createElement("span"), { textContent: words.shown });
    shown.setAttribute("aria-hidden", "true");
    const spoken = Object.assign(document.createElement("span"), { className: "visually-hidden", textContent: words.spoken });
    text.replaceChildren(shown, spoken);
  } else {
    text.textContent = words.shown;
  }
  statusEl.hidden = false;
};

showStatus(STATUS);

const BORN_YEAR = 2000;
const ROLLOVER_MONTH = 7;

const ageOn = (date) =>
  date.getUTCFullYear() - BORN_YEAR - (date.getUTCMonth() < ROLLOVER_MONTH ? 1 : 0);

const numberInWords = (n) => {
  const ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
  if (n < 1000) return ones[Math.floor(n / 100)] + " hundred" + (n % 100 ? " and " + numberInWords(n % 100) : "");
  return String(n);
};

const ageEl = document.querySelector("[data-age]");
if (ageEl) ageEl.textContent = numberInWords(ageOn(new Date()));

const latelyRows = document.querySelectorAll("[data-lately]");

if (latelyRows.length && window.fetch) {
  const LINK_HOST = { listening: "open.spotify.com", playing: "store.steampowered.com" };
  const PICTURE = { listening: "now-art", playing: "lately-art" };

  const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };
  const safeLink = (url, host) => {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && (u.hostname === host || u.hostname.endsWith("." + host)) ? u.href : "";
    } catch (e) {
      return "";
    }
  };

  const ago = (iso) => {
    const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (!Number.isFinite(minutes)) return null;
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : days < 14 ? `${days} days ago` : null;
  };
  const when = (iso) => {
    const t = el("time", null, ago(iso) || new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toLowerCase());
    t.dateTime = iso;
    t.dataset.ago = "";
    return t;
  };

  const fill = (li, row, data) => {
    const entry = li.querySelector(".lately-entry");
    const item = data && data.item;
    const text = el("span", "lately-text");
    if (!item || !item.title) {
      const down = !data || data.status === "unavailable" || data.status === "unconfigured";
      text.append(el("span", "lately-none", down ? "unavailable right now" : "nothing right now"));
      entry.replaceChildren(text);
      return;
    }
    const parts = [];
    if (typeof item.image === "string" && item.image.startsWith("/api/art/")) {
      const img = el("img", PICTURE[row]);
      Object.assign(img, { src: item.image, alt: "", width: 32, height: 32, decoding: "async" });
      img.addEventListener("error", () => img.remove());
      parts.push(img);
    }

    const playingNow = row === "listening" && data.state === "playing" && !data.stale;
    const spoken = row === "listening"
      ? (playingNow ? "listening now on Spotify" : "last played on Spotify")
      : "recently played on Steam";
    text.append(el("span", "visually-hidden", `${spoken}: `));

    const href = safeLink(item.url, LINK_HOST[row]);
    const title = el(href ? "a" : "span", "lately-title", item.title);
    if (href) Object.assign(title, { href, rel: "noreferrer" });
    text.append(title);

    const sub = el("span", "lately-sub");
    const dot = () => { const d = el("span", null, " · "); d.setAttribute("aria-hidden", "true"); return d; };
    if (row === "listening") {
      if (item.subtitle) sub.append(item.subtitle);
      if (playingNow) sub.append(...(item.subtitle ? [dot()] : []), el("span", "lately-now", "now"));
      else if (item.at) sub.append(...(item.subtitle ? [dot()] : []), when(item.at));
    } else {
      const m = Number(item.minutes2weeks);
      if (item.at) sub.append(when(item.at));
      if (m > 0) sub.append(...(item.at ? [dot()] : []), `${m >= 60 ? `${Math.round(m / 30) / 2}h` : `${m} min`} this fortnight`);
    }
    if (sub.childNodes.length) text.append(sub);
    entry.replaceChildren(...parts, text);
  };

  const load = (li) => {
    const row = li.dataset.lately;
    return fetch(`/api/${row}`, { headers: { Accept: "application/json" } })
      .then((res) => res.json())
      .then((data) => fill(li, row, data))
      .catch(() => fill(li, row, null));
  };

  latelyRows.forEach(load);

  const listening = document.querySelector('[data-lately="listening"]');
  if (listening) {
    setInterval(() => { if (!document.hidden) load(listening); }, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) load(listening); });
  }

  setInterval(() => document.querySelectorAll("time[data-ago]").forEach((t) => {
    const text = ago(t.dateTime);
    if (text) t.textContent = text;
  }), 60000);
}
