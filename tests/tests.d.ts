// A fixture imports a SQL file as text, which the Worker bundler loads.
declare module "*.sql" {
  const sql: string;
  export default sql;
}
