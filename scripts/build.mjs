import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = join(root, "content");
const outDir = join(root, "public");

const GENERATED = '<meta name="generator" content="scripts/build.mjs">';
const HOME_PROJECTS = 3;
const HOME_ROLES = 2;
const YEAR = new Date().getFullYear();

const warnings = [];
const warn = (file, message) => warnings.push(`  ${file}: ${message}`);

const escapeHtml = (text) =>
  String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeUrl = (url, { allowRelative = true, allowMailto = true } = {}) => {
  const value = String(url ?? "").trim();
  if (!value) return "";
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return "";
  const scheme = value.match(/^([^/?#]*):/);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name === "http" || name === "https") return value;
    if (name === "mailto" && allowMailto) return value;
    return "";
  }
  return allowRelative ? value : "";
};

const scalar = (raw) => {
  const value = raw.trim();
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value.slice(1, -1);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
};

const readEntry = (path, label) => {
  const raw = readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = raw.match(/^---\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)([\s\S]*)$/);
  if (!match) {
    warn(label, "no frontmatter (the --- block at the top); skipped");
    return null;
  }
  const data = {};
  let listKey = null;
  for (const line of (match[1] ?? "").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) {
      if (!Array.isArray(data[listKey])) data[listKey] = [];
      data[listKey].push(scalar(item[1]));
      continue;
    }
    const pair = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!pair) {
      warn(label, `couldn't read the line "${line.trim()}"`);
      continue;
    }
    const [, key, value] = pair;
    listKey = key;
    if (/^\[.*\]$/.test(value.trim())) {
      data[key] = value.trim().slice(1, -1).split(",").map(scalar).filter((v) => v !== "");
    } else {
      data[key] = value.trim() === "" ? "" : scalar(value);
    }
  }
  return { data, body: match[2] };
};

const readFolder = (folder) => {
  const dir = join(contentDir, folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({ file: `${folder}/${name}`, name, ...readEntry(join(dir, name), `${folder}/${name}`) }))
    .filter((entry) => entry.data);
};

const text = (value) => (typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim());
const isTrue = (value) => value === true || value === "true";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const readDate = (value, file, field) => {
  const raw = text(value);
  if (!raw) return null;
  const m = raw.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m || (m[2] && (+m[2] < 1 || +m[2] > 12)) || (m[3] && (+m[3] < 1 || +m[3] > 31))) {
    warn(file, `${field} "${raw}" isn't a date like 2025, 2025-03 or 2025-03-14; ignored`);
    return null;
  }
  const [year, month, day] = [+m[1], m[2] ? +m[2] : 0, m[3] ? +m[3] : 0];
  return { year, month, day, key: year * 10000 + month * 100 + day };
};
const monthYear = (date) => (date.month ? `${MONTHS[date.month - 1]} ${date.year}` : `${date.year}`);

const inline = (raw) => {
  const codes = [];
  let s = raw.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  const unescape = (v) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt, url) => {
    const href = safeUrl(unescape(url), { allowMailto: false });
    return href ? `<img src="${escapeHtml(href)}" alt="${alt}" loading="lazy">` : alt;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, url) => {
    const href = safeUrl(unescape(url));
    if (!href) return label;
    const external = /^https?:/i.test(href);
    return `<a href="${escapeHtml(href)}"${external ? ' rel="noreferrer"' : ""}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
};

const markdown = (source) => {
  const lines = source.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^```/.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 4);
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${markdown(quote.join("\n"))}</blockquote>`);
      continue;
    }
    const bullet = /^\s*[-*+]\s+/, numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const pattern = bullet.test(line) ? bullet : numbered;
      const tag = pattern === bullet ? "ul" : "ol";
      const items = [];
      while (i < lines.length && pattern.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(pattern, ""))}</li>`);
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])) paragraph.push(lines[i++].trim());
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  return out.join("\n");
};

const config = (() => {
  const defaults = { badges: { projects: true, experience: true } };
  const file = join(root, "site.config.json");
  if (!existsSync(file)) return defaults;
  try {
    const c = JSON.parse(readFileSync(file, "utf8"));
    return { badges: { ...defaults.badges, ...(c && typeof c.badges === "object" ? c.badges : {}) } };
  } catch {
    warn("site.config.json", "isn't valid JSON; used the defaults");
    return defaults;
  }
})();

const list = (value) => (Array.isArray(value) ? value : text(value) ? text(value).split(",") : []).map(text).filter(Boolean);
const lucide = (value) => (/^[a-z0-9-]{1,40}$/.test(text(value)) ? text(value) : "");

const slugify = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const projects = [];
for (const entry of readFolder("projects")) {
  const d = entry.data;
  if (isTrue(d.draft)) continue;
  const title = text(d.title) || (warn(entry.file, "no title; used the file name"), entry.name.replace(/\.md$/, ""));
  const slug = slugify(d.slug || entry.name.replace(/\.md$/, ""));
  if (!slug) { warn(entry.file, "no usable slug; skipped"); continue; }
  if (projects.some((p) => p.slug === slug)) { warn(entry.file, `slug "${slug}" is already used; skipped`); continue; }
  const url = safeUrl(text(d.url), { allowRelative: false, allowMailto: false });
  if (text(d.url) && !url) warn(entry.file, `url "${text(d.url)}" isn't an http(s) address; ignored`);
  projects.push({
    title, slug, url,
    tools: [...list(d.tools), ...list(d.tags)],
    skills: list(d.skills),
    summary: text(d.summary),
    status: text(d.status),
    date: readDate(d.date, entry.file, "date"),
    pinned: isTrue(d.pinned),
    body: entry.body,
    file: entry.file,
  });
}
const byDate = (a, b) => (b.date?.key ?? -1) - (a.date?.key ?? -1) || a.title.localeCompare(b.title);
projects.sort(byDate);

const roles = [];
for (const entry of readFolder("experience")) {
  const d = entry.data;
  if (isTrue(d.draft)) continue;
  const category = text(d.category).toLowerCase() || "work";
  if (category !== "work" && category !== "education") {
    warn(entry.file, `category "${text(d.category)}" should be work or education; skipped`);
    continue;
  }
  const company = text(d.company) || text(d.institution) || text(d.organisation);
  const role = text(d.role) || text(d.course) || text(d.title);
  if (!company || !role) { warn(entry.file, "needs an employer (or institution) and a role (or course); skipped"); continue; }
  const start = readDate(d.start, entry.file, "start");
  if (!start) warn(entry.file, "no start date, so it's sorted last");
  const endRaw = text(d.end).toLowerCase();
  const ongoing = isTrue(d.current) || endRaw === "now" || endRaw === "present";
  const end = ongoing || endRaw === "" ? null : readDate(d.end, entry.file, "end");
  const order = text(d.order) === "" ? null : Number(d.order);
  const logo = safeUrl(text(d.logo), { allowMailto: false });
  if (text(d.logo) && (!logo || /^https?:/i.test(logo))) warn(entry.file, `logo "${text(d.logo)}" should be a path inside public/; ignored`);
  roles.push({
    category, company, role, start, end,
    current: ongoing,
    type: text(d.type),
    summary: text(d.summary),
    order: Number.isFinite(order) ? order : null,
    body: entry.body,
    tools: list(d.tools),
    skills: list(d.skills),
    icon: lucide(d.icon) || (category === "education" ? "graduation-cap" : "briefcase-business"),
    logo: logo && !/^https?:/i.test(logo) ? logo.replace(/^\/+/, "") : "",
  });
}
roles.sort((a, b) =>
  (b.start?.key ?? -1) - (a.start?.key ?? -1) ||
  (a.order ?? Infinity) - (b.order ?? Infinity) ||
  (b.end?.key ?? Infinity) - (a.end?.key ?? Infinity));

const icon = (p, id, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="${p}icons/icons.svg#${id}"></use></svg>`;

const badges = (item, { limit = null, enabled = true } = {}) => {
  if (!enabled) return "";
  const all = [...item.tools.map((name) => ({ name, kind: "tool" })), ...item.skills.map((name) => ({ name, kind: "skill" }))];
  if (!all.length) return "";
  const shown = limit ? all.slice(0, limit) : all;
  const label = item.tools.length && item.skills.length ? "tools and skills" : item.tools.length ? "tools" : "skills";
  return `<ul class="badges" aria-label="${label}">${shown.map((b) => `<li class="badge badge-${b.kind}">${escapeHtml(b.name)}</li>`).join("")}</ul>`;
};

const projectRow = (p, project, { limit = null } = {}) => {
  const tags = badges(project, { limit, enabled: config.badges.projects });
  return `
          <li>
            <a href="${p}projects/${project.slug}/">
              <span class="project-text">
                <span class="project-name">${escapeHtml(project.title)}</span>${project.summary ? `
                <span class="project-summary">${escapeHtml(project.summary)}</span>` : ""}
              </span>${project.date ? `
              <span class="project-meta">${project.date.year}</span>` : ""}
              ${icon(p, "arrow-right", "icon go")}
            </a>${tags ? `
            ${tags}` : ""}
          </li>`;
};

const roleDates = (role, long) => {
  const show = long ? monthYear : (d) => `${d.year}`;
  const start = role.start ? show(role.start) : "";
  const end = role.current ? "now" : role.end ? show(role.end) : "";
  if (!long && start && start === end) return start;
  return [start, end].filter(Boolean).join(" - ");
};

const homeRole = (role) => `
          <li class="home-role">
            <span class="home-role-text">
              <span class="home-role-title">${escapeHtml(role.role)}</span>
              <span class="home-role-org">${escapeHtml(role.company)}</span>
            </span>
            <span class="role-dates">${escapeHtml(roleDates(role, false))}</span>
          </li>`;

const timelineEntry = (p, role) => {
  const meta = [roleDates(role, true), role.type].filter(Boolean).map(escapeHtml).join(` <span aria-hidden="true">·</span> `);
  const head = `
                <span class="entry-title">${escapeHtml(role.role)}</span>${meta ? `
                <span class="entry-meta">${meta}</span>` : ""}`;
  const detail = [role.summary ? `<p>${escapeHtml(role.summary)}</p>` : "", markdown(role.body)].filter(Boolean).join("\n");
  const tags = badges(role, { enabled: config.badges.experience });
  const main = detail
    ? `
              <details class="entry-details">
                <summary>
                  <span class="entry-head">${head}
                  </span>
                  ${icon(p, "chevron-down", "icon chev")}
                </summary>
                <div class="entry-more">
                  ${detail}
                </div>
              </details>`
    : `
              <div class="entry-head">${head}
              </div>`;
  return `
            <li class="entry">
              <span class="entry-icon" aria-hidden="true">${icon(p, role.icon)}</span>
              <div class="entry-body">${main}${tags ? `
                ${tags}` : ""}
              </div>
            </li>`;
};

const moreLink = (href, what) => `<a class="more" href="${href}">
            more<span class="visually-hidden"> ${what}</span>
            <svg class="icon" aria-hidden="true"><use href="icons/icons.svg#arrow-right"></use></svg>
          </a>`;

const PROJECTS_NOTE = `<span class="annotation hand-note hand-note-projects" aria-hidden="true"><svg class="scribble" viewBox="0 0 26 18"><path class="stroke" d="M24.5 4.5c-3.2-1-7.6-.6-11 1.6-3.1 2-5.6 5.3-7.9 8.6"/><path class="head" d="M10.2 12.5 5.6 14.7 6 9.6"/></svg>the ones i'd show you first</span>`;

const homeProjects = () => {
  const pinned = projects.filter((project) => project.pinned).slice(0, HOME_PROJECTS);
  if (!pinned.length) return `<section class="projects" data-build="projects" hidden></section>`;
  return `
      <section class="projects" data-build="projects" aria-labelledby="projects-title">
        <div class="section-head">
          <h2 id="projects-title" class="label">
            ${icon("", "folder-open")}
            projects
          </h2>
          ${PROJECTS_NOTE}
          ${moreLink("projects/", "projects")}
        </div>
        <ul class="project-list">${pinned.map((project) => projectRow("", project, { limit: 3 })).join("")}
        </ul>
      </section>
`;
};

const homeExperience = () => {
  const latest = roles.filter((role) => role.category === "work").slice(0, HOME_ROLES);
  const body = latest.length
    ? `<ul class="home-roles">${latest.map(homeRole).join("")}
        </ul>`
    : `<p class="empty-row">work history coming soon.</p>`;
  return `
      <section class="experience" data-build="experience" aria-labelledby="experience-title">
        <div class="section-head">
          <h2 id="experience-title" class="label">
            ${icon("", "briefcase-business")}
            experience
          </h2>
          ${moreLink("experience/", "experience")}
        </div>
        ${body}
      </section>
`;
};

const page = ({ depth, title, description, current, mainClass, main }) => {
  const p = "../".repeat(depth);
  const nav = (href, label, key) => `<a href="${p}${href}"${current === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html>
<html lang="en-GB" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${GENERATED}
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">

  <script>
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
    } catch (e) {}
  </script>

  <link rel="preload" href="${p}fonts/jost-latin-wght.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${p}css/style.css">
  <link rel="icon" href="${p}favicon.png" type="image/png">
  <script src="${p}js/site.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">skip to content</a>

  <header class="site-header">
    <a class="wordmark" href="${p || "./"}">h<span class="x">x</span>rry<span class="tld">.dev</span></a>
    <nav aria-label="Main">
      ${nav("", "home", "home")}
      ${nav("projects/", "projects", "projects")}
    </nav>
    <button class="theme-toggle" type="button" aria-label="Switch to light theme" hidden>
      ${icon(p, "sun", "icon icon-sun")}
      ${icon(p, "moon", "icon icon-moon")}
    </button>
  </header>

  <main id="main" class="page ${mainClass}">
${main}
  </main>

  <footer class="site-footer">
    <p>© ${YEAR} harry · <a href="https://github.com/hxrry27/hxrry.dev" rel="noreferrer">source on GitHub</a></p>
  </footer>
</body>
</html>
`;
};

const projectsPage = () => page({
  depth: 1,
  title: "projects · hxrry.dev",
  description: "things harry has worked on.",
  current: "projects",
  mainClass: "projects-page",
  main: `    <header class="case-head">
      <h1>projects</h1>
      <p class="lede">things i've built, run or tinkered with.</p>
    </header>
${projects.length
    ? `    <ul class="project-list">${projects.map((project) => projectRow("../", project)).join("")}
    </ul>`
    : `    <p class="coming-soon">nothing here yet.</p>`}`,
});

const casePage = (project) => {
  const site = project.url
    ? `<a href="${escapeHtml(project.url)}" rel="noreferrer">${escapeHtml(project.url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""))}${icon("../../", "arrow-up-right")}</a>`
    : "";
  const facts = [
    ["status", project.status ? escapeHtml(project.status) : ""],
    ["year", project.date ? escapeHtml(monthYear(project.date)) : ""],
    ["site", site],
    ["tools", config.badges.projects ? badges({ tools: project.tools, skills: [] }) : ""],
    ["skills", config.badges.projects ? badges({ tools: [], skills: project.skills }) : ""],
  ].filter(([, value]) => value);
  const body = markdown(project.body);
  const others = projects.filter((p) => p.slug !== project.slug);
  return page({
    depth: 2,
    title: `${project.title} · hxrry.dev`,
    description: project.summary || `${project.title}, a project by harry.`,
    current: "projects",
    mainClass: "case-study",
    main: `    <p class="back"><a href="../">${icon("../../", "arrow-left")}projects</a></p>
    <header class="case-head">
      <h1>${escapeHtml(project.title)}</h1>${project.summary ? `
      <p class="lede">${escapeHtml(project.summary)}</p>` : ""}${facts.length ? `
      <dl class="facts-row">${facts.map(([label, value]) => `
        <div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}
      </dl>` : ""}
    </header>
${body ? `    <div class="prose">
${body}
    </div>` : `    <p class="coming-soon">a proper write-up is coming soon.</p>`}${others.length ? `

    <nav class="more-projects" aria-labelledby="more-projects-title">
      <h2 id="more-projects-title" class="label">${icon("../../", "folder-open")}more projects</h2>
      <ul class="project-list">${others.map((p) => projectRow("../../", p)).join("")}
      </ul>
    </nav>` : ""}`,
  });
};

const CATEGORIES = [
  { key: "work", heading: "work", icon: "briefcase-business" },
  { key: "education", heading: "education", icon: "graduation-cap" },
];

const experiencePage = () => {
  let n = 0;
  const sections = CATEGORIES.map(({ key, heading, icon: iconId }) => {
    const groups = [];
    for (const role of roles.filter((r) => r.category === key)) {
      let group = groups.find((g) => g.company.toLowerCase() === role.company.toLowerCase());
      if (!group) groups.push((group = { company: role.company, logo: "", roles: [] }));
      if (role.logo && !group.logo) group.logo = role.logo;
      group.roles.push(role);
    }
    if (!groups.length) return "";
    const mark = (group) => group.logo
      ? `<img class="org-mark" src="../${escapeHtml(group.logo)}" alt="" width="28" height="28">`
      : `<span class="org-mark" aria-hidden="true">${escapeHtml([...group.company][0].toUpperCase())}</span>`;
    return `
    <section class="history" aria-labelledby="history-${key}">
      <h2 class="label" id="history-${key}">${icon("../", iconId)}${heading}</h2>${groups.map((group) => `
      <section class="employer" aria-labelledby="employer-${++n}">
        <div class="employer-head">
          ${mark(group)}
          <h3 class="employer-name" id="employer-${n}">${escapeHtml(group.company)}</h3>
        </div>
        <ol class="timeline">${group.roles.map((role) => timelineEntry("../", role)).join("")}
        </ol>
      </section>`).join("")}
    </section>`;
  }).filter(Boolean).join("\n");
  return page({
    depth: 1,
    title: "experience · hxrry.dev",
    description: "where harry has worked and studied.",
    current: "experience",
    mainClass: "experience-page",
    main: `    <header class="case-head">
      <h1>experience</h1>
      <p class="lede">where i've worked, and what i've studied.</p>
    </header>
${sections || `    <p class="coming-soon">the full history is being written up and will appear here soon.</p>`}`,
  });
};

const lately = (() => {
  const file = join(contentDir, "lately.md");
  return existsSync(file) ? (readEntry(file, "lately.md") || { data: {} }).data : {};
})();
const str = (v, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

const readingRow = () => {
  const title = str(lately.title);
  const author = str(lately.author);
  const url = /^https:\/\//i.test(safeUrl(str(lately.url, 500), { allowRelative: false, allowMailto: false })) ? str(lately.url, 500) : "";
  const cover = (() => {
    const path = str(lately.cover).replace(/^\/+/, "");
    if (!/^[\w./-]+\.(jpe?g|png|webp|gif|avif)$/i.test(path) || path.includes("..") || !existsSync(join(outDir, path))) return "";
    return `${path}?v=${createHash("sha256").update(readFileSync(join(outDir, path))).digest("hex").slice(0, 8)}`;
  })();
  const text = title
    ? `${url ? `
                  <a class="lately-title" href="${escapeHtml(url)}" rel="noreferrer">${escapeHtml(title)}</a>` : `
                  <span class="lately-title">${escapeHtml(title)}</span>`}${author ? `
                  <span class="lately-sub">${escapeHtml(author)}</span>` : ""}`
    : `
                  <span class="lately-none">nothing right now</span>`;
  return `
            <li class="reading" data-build="reading">
              ${icon("", "book-open")}
              <span class="lately-kind">reading</span>
              <span class="lately-entry">${cover ? `
                <img class="lately-art" src="${escapeHtml(cover)}" alt="" width="32" height="32">` : ""}
                <span class="lately-text">${text}
                </span>
              </span>
            </li>`;
};

const ASSETS = ["icons/icons.svg", "css/style.css", "js/site.js"];
const versions = Object.fromEntries(ASSETS.map((asset) => {
  const file = join(outDir, asset);
  return [asset, existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8) : ""];
}));

const stamp = (html) => ASSETS.reduce((out, asset) => {
  if (!versions[asset]) return out;
  const pattern = new RegExp(`(${asset.replace(/[./]/g, "\\$&")})(\\?v=[0-9a-f]*)?(?=[#"])`, "g");
  return out.replace(pattern, `$1?v=${versions[asset]}`);
}, html);

const write = (path, html) => {
  if (existsSync(path) && !readFileSync(path, "utf8").includes(GENERATED)) {
    warn(path.replace(outDir, "public"), "wasn't made by the build (no generator tag), so it was left alone. Move its content into content/, or delete the page so the build can recreate it");
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stamp(html));
};

const replaceBuilt = (html, name, fresh) => {
  const open = new RegExp(`<(\\w+)\\b[^>]*\\sdata-build="${name}"[^>]*>`).exec(html);
  if (!open) throw new Error(`public/index.html has no element with data-build="${name}"`);
  const tags = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, "g");
  tags.lastIndex = open.index + open[0].length;
  for (let depth = 1, m; (m = tags.exec(html));) {
    depth += m[1] ? -1 : 1;
    if (!depth) return html.slice(0, open.index) + fresh.trim() + html.slice(m.index + m[0].length);
  }
  throw new Error(`public/index.html: the data-build="${name}" element isn't closed`);
};

const homePath = join(outDir, "index.html");
let home = readFileSync(homePath, "utf8");
const newline = home.includes("\r\n") ? "\r\n" : "\n";
home = home.replace(/\r\n/g, "\n");
const sections = [["projects", homeProjects()], ["experience", homeExperience()], ["reading", readingRow()]];
for (const [name, html] of sections) home = replaceBuilt(home, name, html);
const updatedHome = stamp(home).replace(/\n/g, newline);
if (updatedHome !== readFileSync(homePath, "utf8")) writeFileSync(homePath, updatedHome);

write(join(outDir, "projects/index.html"), projectsPage());
for (const project of projects) write(join(outDir, "projects", project.slug, "index.html"), casePage(project));
write(join(outDir, "experience/index.html"), experiencePage());

for (const name of readdirSync(join(outDir, "projects"))) {
  const dir = join(outDir, "projects", name);
  if (!statSync(dir).isDirectory() || projects.some((p) => p.slug === name)) continue;
  const index = join(dir, "index.html");
  if (existsSync(index) && readFileSync(index, "utf8").includes(GENERATED)) {
    rmSync(dir, { recursive: true });
    console.log(`removed old page projects/${name}/`);
  }
}

const pinnedCount = Math.min(projects.filter((p) => p.pinned).length, HOME_PROJECTS);
console.log(`built: ${projects.length} project(s) (${pinnedCount} on the homepage), ${roles.length} role(s) (${Math.min(roles.filter((r) => r.category === "work").length, HOME_ROLES)} on the homepage)`);
if (warnings.length) console.log(`warnings:\n${warnings.join("\n")}`);
