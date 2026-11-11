/**
 * SYNTHETIC sample change for a fictional "orders-service" repository, with deliberately
 * planted defects. EXPECTED_DETERMINISTIC lists the findings the static rules must report
 * (path, line, rule); it is used by tests and the demo seed.
 */
export const SAMPLE_DIFF = `diff --git a/src/orders/orders.repository.ts b/src/orders/orders.repository.ts
index 3f2a1b0..8c9d4e1 100644
--- a/src/orders/orders.repository.ts
+++ b/src/orders/orders.repository.ts
@@ -1,12 +1,26 @@
 import { db } from '../db';
+import { logger } from '../logger';
 
 export class OrdersRepository {
-  async findById(id: string) {
-    return db.query('SELECT id, status FROM orders WHERE id = $1', [id]);
+  async findById(id: string) {
+    return db.query("SELECT * FROM orders WHERE id = '" + id + "'");
   }
 
-  async listForCustomer(customerId: string) {
-    return db.query('SELECT id FROM orders WHERE customer_id = $1', [customerId]);
+  async listWithItems(orderIds: string[]) {
+    const result = [];
+    for (const id of orderIds) {
+      const items = await db.query('SELECT sku, qty FROM order_items WHERE order_id = $1', [id]);
+      result.push({ id, items });
+    }
+    return result;
+  }
+
+  async markPaid(id: string) {
+    try {
+      await db.query('UPDATE orders SET status = $2 WHERE id = $1', [id, 'paid']);
+    } catch (e) {}
   }
 }
diff --git a/src/orders/orders.controller.ts b/src/orders/orders.controller.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/orders/orders.controller.ts
+++ b/src/orders/orders.controller.ts
@@ -5,6 +5,14 @@ import { OrdersRepository } from './orders.repository';
 const repo = new OrdersRepository();
 
 export async function getOrder(req: Request, res: Response) {
   const order = await repo.findById(req.params.id);
   res.json(order);
 }
+
+export async function applyDiscount(req: Request, res: Response) {
+  const pct = parseInt(req.body.percent);
+  console.log('discount', req.body);
+  // TODO cap discounts per customer tier
+  res.json({ applied: pct });
+}
`;

export const EXPECTED_DETERMINISTIC = [
  { path: 'src/orders/orders.repository.ts', line: 6, rule: 'rule:sql-injection-concat' },
  { path: 'src/orders/orders.repository.ts', line: 6, rule: 'rule:select-star' },
  { path: 'src/orders/orders.repository.ts', line: 12, rule: 'rule:n-plus-one' },
  { path: 'src/orders/orders.repository.ts', line: 21, rule: 'rule:empty-catch' },
  { path: 'src/orders/orders.controller.ts', line: 14, rule: 'rule:debug-output' },
  { path: 'src/orders/orders.controller.ts', line: 15, rule: 'rule:todo' },
  { path: 'src/orders/orders.repository.ts', line: 2, rule: 'rule:missing-tests' },
  { path: 'src/orders/orders.controller.ts', line: 11, rule: 'rule:missing-tests' },
];
