const DEFAULT_ORDER_EXPIRY_HOURS = 24;

async function expireStaleSubmittedOrders(db, options = {}) {
  const now = options.now || new Date();
  const hours = options.hours || DEFAULT_ORDER_EXPIRY_HOURS;
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const candidates = await db.order.findMany({
    where: { status: "SUBMITTED", createdAt: { lt: cutoff } },
    select: { id: true, campaignId: true }
  });
  let expired = 0;
  for (const candidate of candidates) {
    const didExpire = await db.$transaction(async tx => {
      // Use the same Campaign row lock as order creation. Expiry either releases
      // the slot before a creator counts reservations, or the creator counts it
      // once and expiry releases it immediately afterward; the cap is never oversold.
      await tx.$queryRawUnsafe('SELECT id FROM "Campaign" WHERE id = $1 FOR UPDATE', candidate.campaignId);
      const order = await tx.order.findUnique({ where: { id: candidate.id } });
      if (!order || order.status !== "SUBMITTED" || order.createdAt >= cutoff) return false;
      await tx.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED", cancelledAt: now, cancelReason: "Buyer confirmation expired" }
      });
      await tx.orderEvent.create({
        data: { orderId: order.id, type: "ORDER_EXPIRED", actorRole: "SYSTEM", metadata: { expiryHours: hours } }
      });
      return true;
    });
    if (didExpire) expired++;
  }
  return { expired, cutoff };
}

module.exports = { DEFAULT_ORDER_EXPIRY_HOURS, expireStaleSubmittedOrders };
