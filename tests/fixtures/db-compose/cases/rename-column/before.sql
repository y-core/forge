CREATE TABLE posts (id INTEGER PRIMARY KEY, body TEXT) STRICT;
CREATE INDEX posts_body ON posts (body);
