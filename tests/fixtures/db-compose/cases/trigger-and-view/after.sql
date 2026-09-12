CREATE TABLE posts (id INTEGER PRIMARY KEY, body TEXT, edits INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE TRIGGER posts_edited AFTER UPDATE OF body ON posts BEGIN UPDATE posts SET edits = edits + 1 WHERE id = NEW.id; END;
CREATE VIEW edited_posts AS SELECT id, edits FROM posts WHERE edits > 0;
