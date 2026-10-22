// Build check: runs `zeus build` even without real Spotify credentials.
// If app-side/secrets.js is missing, the example stub is copied in for the
// build and removed afterwards. Real secrets are never touched.
//
// Run: npm run check
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const secrets = path.join(root, "app-side", "secrets.js");
const stub = !existsSync(secrets);

if (stub) copyFileSync(path.join(root, "app-side", "secrets.example.js"), secrets);
try {
  const r = spawnSync("zeus", ["build"], { cwd: root, encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const ok = r.status === 0 && !/error/i.test(out);
  console.log(ok ? out.trim().split("\n").filter((l) => l.endsWith(".zab")).join("\n") || "build ok" : out);
  process.exitCode = ok ? 0 : 1;
} finally {
  if (stub) rmSync(secrets);
}
