import { explainPlan, openTestD1, usesIndex } from "@y-core/forge/testing/d1";

import { createPostsService, postsByUser } from "./posts-service.ts";

const db = await openTestD1();
try {
  await db.binding.prepare("INSERT INTO posts (id, user_id) VALUES (1, 7), (2, 7), (3, 8)").run();
  const query = postsByUser(7);
  const plan = await explainPlan(db, query.text, query.params);
  if (!usesIndex(plan, "posts_user")) throw new Error(`postsByUser does not read through posts_user: ${JSON.stringify(plan)}`);
  const posts = createPostsService(db.binding);
  const [byUser, post] = await Promise.all([posts.byUser(7), posts.post(3)]);
  console.log(JSON.stringify({ indexed: true, byUser: byUser.ok ? byUser.data : byUser.error.kind, post: post.ok ? post.data : post.error.kind }));
} finally {
  await db.dispose();
}
