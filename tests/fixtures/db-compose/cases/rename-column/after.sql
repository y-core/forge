CREATE TABLE posts (id INTEGER PRIMARY KEY, content TEXT) STRICT;
CREATE INDEX posts_body ON posts (content);
