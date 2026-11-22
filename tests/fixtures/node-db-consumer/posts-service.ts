import { createD1Client, createRowLoader, type D1Outcome, type D1Queryable, type SqlFragment, sql } from "@y-core/forge/storage/db";

export interface Post {
  id: number;
  user_id: number;
}

export interface PostsService {
  byUser(userId: number): Promise<D1Outcome<Post[]>>;
  post(id: number): Promise<D1Outcome<Post | null>>;
}

export const postsByUser = (userId: number): SqlFragment => sql`SELECT id, user_id FROM posts WHERE user_id = ${userId} ORDER BY id`;

export function createPostsService(db: D1Queryable): PostsService {
  const client = createD1Client(db);
  const posts = createRowLoader<number, Post>(client, {
    select: (keysJson) => sql`SELECT id, user_id FROM posts WHERE id IN (SELECT value FROM json_each(${keysJson}))`,
    keyOf: (post) => post.id,
  });
  return { byUser: (userId) => client.query<Post>(postsByUser(userId)), post: (id) => posts.load(id) };
}
