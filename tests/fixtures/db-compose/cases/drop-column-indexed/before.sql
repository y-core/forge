CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, nickname TEXT) STRICT;
CREATE INDEX users_nickname ON users (nickname);
