// Local-only convenience: Node 22+ can load TEST_DATABASE_URL from an uncommitted .env.
// Vercel does not execute this script during install/build/preview.
if (typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(".env"); } catch (error) { if (error.code !== "ENOENT") throw error; }
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
