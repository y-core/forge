/// <reference path="../../../src/testing/node.d.ts" />
import { explainPlan, openTestD1, type OpenTestD1Options, type PlanStep, scansTable, sql, type TestD1, usesIndex } from "@y-core/forge/testing/d1";

export const planOf = async (options: OpenTestD1Options): Promise<readonly PlanStep[]> => {
  const db: TestD1 = await openTestD1(options);
  try {
    const plan = await explainPlan(db, sql`SELECT id FROM posts WHERE user_id = ${1}`);
    return usesIndex(plan, "posts_user") || scansTable(plan, "posts") ? plan : [];
  } finally {
    await db.dispose();
  }
};
