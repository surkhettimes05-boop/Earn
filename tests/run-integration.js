const { spawnSync } = require("node:child_process");

function fail(message) {
  console.error("Integration test safety check failed: " + message);
  process.exit(1);
}

function parseDatabaseUrl(name, value) {
  if (!value) fail(name + " is unset.");
  let url;
  try { url = new URL(value); }
  catch { fail(name + " is not a valid URL."); }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    fail(name + " must be a PostgreSQL URL.");
  }
  return url;
}

const testRaw = process.env.TEST_DATABASE_URL;
const prodRaw = process.env.DATABASE_URL;
const testUrl = parseDatabaseUrl("TEST_DATABASE_URL", testRaw);

if (prodRaw && testRaw === prodRaw) {
  fail("TEST_DATABASE_URL must not equal DATABASE_URL.");
}

const databaseName = decodeURIComponent(testUrl.pathname.replace(/^\//, ""));
const hostOrDatabase = (testUrl.hostname + "/" + databaseName).toLowerCase();
if (!hostOrDatabase.includes("test")) {
  fail('the test database host or database name must contain "test".');
}

// Prisma schema reads DATABASE_URL. Override it only inside this child process;
// the caller's environment and .env are not modified.
const env = { ...process.env, DATABASE_URL: testRaw, NODE_ENV: "test" };

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
