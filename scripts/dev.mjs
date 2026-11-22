import { spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const build = () => spawnSync(process.execPath, [join(root, "scripts", "build.mjs")], { stdio: "inherit" });

build();

let timer;
const rebuild = () => {
  clearTimeout(timer);
  timer = setTimeout(build, 150);
};
for (const path of ["content", "public/css", "public/js", "public/icons"]) watch(join(root, path), { recursive: true }, rebuild);
watch(join(root, "site.config.json"), rebuild);

const wrangler = spawn("npx", ["--yes", "wrangler@4", "pages", "dev", "--port", "8788"], {
  cwd: root, stdio: "inherit", shell: process.platform === "win32",
});
wrangler.on("exit", (code) => process.exit(code ?? 0));
