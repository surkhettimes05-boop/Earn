const CONNECTION_ENV_NAMES = [
  "DATABASE_URL",
  "DIRECT_URL",
  "SHADOW_DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING"
];

function fail(message) {
  throw new Error("Integration test safety check failed: " + message);
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

function normalize(value) {
  const url = parseDatabaseUrl("database URL", value);
  url.searchParams.sort();
  return url.toString();
}

function assertSafeTestDatabase(env) {
  const testRaw = env.TEST_DATABASE_URL;
  const testUrl = parseDatabaseUrl("TEST_DATABASE_URL", testRaw);
  const databaseName = decodeURIComponent(testUrl.pathname.replace(/^\//, ""));
  const hostOrDatabase = (testUrl.hostname + "/" + databaseName).toLowerCase();

  if (!hostOrDatabase.includes("test")) {
    fail('the test database host or database name must contain "test".');
  }

  const testNormalized = normalize(testRaw);
  if (env.DATABASE_URL && normalize(env.DATABASE_URL) === testNormalized) {
    fail("TEST_DATABASE_URL must not equal DATABASE_URL.");
  }

  return testRaw;
}

function integrationEnv(sourceEnv = process.env) {
  const testRaw = assertSafeTestDatabase(sourceEnv);
  const env = { ...sourceEnv, NODE_ENV: "test" };
  // Defense in depth: Prisma currently reads only DATABASE_URL, but override
  // common Prisma/Postgres connection variables too so future config cannot
  // accidentally route integration tests to a non-test database.
  for (const name of CONNECTION_ENV_NAMES) env[name] = testRaw;
  return env;
}

module.exports = { CONNECTION_ENV_NAMES, assertSafeTestDatabase, integrationEnv };
