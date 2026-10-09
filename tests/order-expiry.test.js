const test = require("node:test");
const assert = require("node:assert/strict");
const { expireStaleSubmittedOrders } = require("../lib/order-expiry");

test("expires stale SUBMITTED orders under the campaign lock and records ORDER_EXPIRED", async () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const stale = { id:"o1", campaignId:"c1", status:"SUBMITTED", createdAt:new Date("2026-10-08T11:59:59Z") };
  const fresh = { id:"o2", campaignId:"c1", status:"SUBMITTED", createdAt:new Date("2026-10-08T12:00:01Z") };
  const orders = new Map([[stale.id,{...stale}],[fresh.id,{...fresh}]]);
  const events=[]; const locks=[];
  const tx={
    $queryRawUnsafe: async(sql,id)=>{locks.push({sql,id})},
    order:{
      findUnique:async({where})=>orders.get(where.id),
      update:async({where,data})=>{Object.assign(orders.get(where.id),data)}
    },
    orderEvent:{create:async({data})=>events.push(data)}
  };
  const db={
    order:{findMany:async()=>[stale]},
    $transaction:async(fn)=>fn(tx)
  };
  const result=await expireStaleSubmittedOrders(db,{now,hours:24});
  assert.equal(result.expired,1);
  assert.equal(orders.get("o1").status,"CANCELLED");
  assert.equal(events.length,1); assert.equal(events[0].type,"ORDER_EXPIRED");
  assert.equal(locks.length,1); assert.match(locks[0].sql,/FOR UPDATE/);
});
