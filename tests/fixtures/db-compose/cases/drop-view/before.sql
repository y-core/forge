CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT);
CREATE VIEW admins AS SELECT id FROM users WHERE role = 'admin';
