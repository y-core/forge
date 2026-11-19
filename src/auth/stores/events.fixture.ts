/** The whitespace-squashed text of one security event insert, each part given as the text it binds or embeds. @internal */
export function securityEventText(
  parts: { readonly user?: string; readonly kind?: string; readonly session?: boolean; readonly guard?: string } = {},
): string {
  const session = parts.session === true ? "(SELECT id FROM auth_sessions WHERE token_hash = ?)" : "NULL";
  return (
    "INSERT INTO auth_security_events (id, user_id, type, factor_kind, session_id, admin_id, at) " +
    `SELECT ?, ${parts.user ?? "?"}, ?, ${parts.kind ?? "?"}, ${session}, ?, ? WHERE ${parts.guard ?? "1"}`
  );
}

/** One statement with every run of whitespace collapsed, as a batch assertion compares it. @internal */
export function squashSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/** An event insert's `params` with its fresh row id, and the clock reading at index `clock` where given, replaced by stable markers. @internal */
export function eventParams(params: readonly unknown[] | undefined, clock?: number): unknown[] {
  return (params ?? []).map((value, index) => {
    if (index === 0 && value instanceof Uint8Array && value.length === 16) return "event-id";
    return index === clock && typeof value === "number" ? "now" : value;
  });
}
