// Local-only convenience: load an uncommitted .env only when it exists.
// CI supplies its environment directly, so a missing .env is an expected no-op.
const fs = require("node:fs");
if (typeof process.loadEnvFile === "function" && fs.existsSync(".env")) {
  process.loadEnvFile(".env");
}
const { spawnSync } = require("node:child_process");
const { integrationEnv } = require("./integration-db-guard");

let env;
try {
  env = integrationEnv(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npx", ["prisma", "migrate", "deploy"]);
run(process.execPath, ["--test", "tests/orders.http.test.js"]);
