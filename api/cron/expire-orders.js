const { PrismaClient } = require("@prisma/client");
const { expireStaleSubmittedOrders } = require("../../lib/order-expiry");
const db = global.__earnDb || new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__earnDb = db;

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== "Bearer " + secret) return json(res, 401, { error: "Unauthorized" });
  try {
    const result = await expireStaleSubmittedOrders(db);
    return json(res, 200, { expired: result.expired, cutoff: result.cutoff.toISOString() });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "Internal server error" });
  }
};
