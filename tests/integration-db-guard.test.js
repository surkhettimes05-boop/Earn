const test = require("node:test");
const assert = require("node:assert/strict");
const { integrationEnv } = require("./integration-db-guard");

const validTest = "postgresql://user:pass@db.example.com:5432/earn_test?sslmode=require";
const prod = "postgresql://user:pass@db.example.com:5432/earn?sslmode=require";

test("guard rejects unset TEST_DATABASE_URL", () => {
  assert.throws(() => integrationEnv({ DATABASE_URL: prod }), /TEST_DATABASE_URL is unset/);
});

test("guard rejects TEST_DATABASE_URL equal to DATABASE_URL", () => {
  assert.throws(() => integrationEnv({ DATABASE_URL: validTest, TEST_DATABASE_URL: validTest }), /must not equal DATABASE_URL/);
});

test('guard rejects URL without "test" in host or database name', () => {
  assert.throws(() => integrationEnv({ DATABASE_URL: prod, TEST_DATABASE_URL: "postgresql://user:pass@db.example.com:5432/earn?sslmode=require" }), /must contain "test"/);
});

test("guard accepts a valid test database and overrides all known connection variables", () => {
  const env = integrationEnv({
    DATABASE_URL: prod,
    TEST_DATABASE_URL: validTest,
    DIRECT_URL: "postgresql://user:pass@prod.example.com:5432/earn",
    SHADOW_DATABASE_URL: "postgresql://user:pass@prod.example.com:5432/shadow",
    POSTGRES_URL: "postgresql://user:pass@prod.example.com:5432/earn",
    POSTGRES_PRISMA_URL: "postgresql://user:pass@prod.example.com:5432/earn",
    POSTGRES_URL_NON_POOLING: "postgresql://user:pass@prod.example.com:5432/earn"
  });
  for (const name of ["DATABASE_URL","DIRECT_URL","SHADOW_DATABASE_URL","POSTGRES_URL","POSTGRES_PRISMA_URL","POSTGRES_URL_NON_POOLING"]) {
    assert.equal(env[name], validTest);
  }
  assert.equal(env.NODE_ENV, "test");
});
