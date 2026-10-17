import type { Middleware, RequestContext } from "@remix-run/fetch-router";

import { contextVar } from "../../context/accessor";
import { setPendingHeader } from "../../context/pending-headers";
import { getAppContext } from "../../context/types";
import type { D1DatabaseLike, D1DatabaseSession, D1PreparedStatement, D1Queryable, D1SessionsOptions } from "./types";

const sessionsCtx = contextVar<Map<D1DatabaseLike, D1DatabaseSession>>("__d1Sessions");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

// D1's bookmark is four hex groups; local D1 writes the last as 32 digits and a Time Travel bookmark as 16.
const BOOKMARK = /^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{16,64}$/i;

/** What this request's queries for `db` go through: its session where `d1Sessions` opened one, else the binding itself. @internal */
// oxlint-disable-next-line typescript/no-explicit-any -- bindings are irrelevant to which session a binding maps to
export function queryableFor(c: RequestContext<any, any>, db: D1DatabaseLike): D1Queryable {
  return sessionsCtx.getOptional(c)?.get(db) ?? db;
}

/** The bookmark a request carries in its header or cookie, or `null` where it carries none in D1's shape. @internal */
export function incomingBookmark(request: Request, carrier: NonNullable<D1SessionsOptions["bookmark"]>): string | null {
  const value =
    "header" in carrier
      ? request.headers.get(carrier.header)
      : (request.headers
          .get("cookie")
          ?.split(";")
          .map((part) => part.trim().split("="))
          .find(([name]) => name === carrier.cookie)?.[1] ?? null);
  return value !== null && BOOKMARK.test(value) ? value : null;
}

/** A session resumed from the client's bookmark, and whether every query sent through it failed — the sign D1 refused that bookmark. */
function watched(session: D1DatabaseSession): { session: D1DatabaseSession; refused: () => boolean } {
  let answered = false;
  let failed = false;
  const settle = async <R>(pending: Promise<R>): Promise<R> => {
    try {
      const answer = await pending;
      answered = true;
      return answer;
    } catch (error) {
      failed = true;
      throw error;
    }
  };
  const inner = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const statement = (prepared: D1PreparedStatement): D1PreparedStatement => {
    const outer: D1PreparedStatement = {
      bind: (...values) => statement(prepared.bind(...values)),
      first: <T>(column?: string) => settle(prepared.first<T>(column)),
      run: () => settle(prepared.run()),
      all: <T>() => settle(prepared.all<T>()),
    };
    inner.set(outer, prepared);
    return outer;
  };
  return {
    session: {
      prepare: (sql) => statement(session.prepare(sql)),
      batch: <T>(statements: D1PreparedStatement[]) => settle(session.batch<T>(statements.map((s) => inner.get(s) ?? s))),
      getBookmark: () => session.getBookmark(),
    },
    refused: () => failed && !answered,
  };
}

/** Middleware that opens one D1 session per request — on the primary for a write or where no bookmark carrier is set, else from the incoming bookmark or any replica — and returns its bookmark on the response. @public */
export function d1Sessions<Bindings = Record<string, unknown>>(options: D1SessionsOptions<Bindings>): Middleware {
  return async (context, next) => {
    const c = getAppContext<Bindings>(context);
    const db = options.binding(c);
    if (db?.withSession === undefined) return next();
    const open = db.withSession.bind(db);

    const carrier = options.bookmark;
    const incoming = carrier === undefined ? null : incomingBookmark(context.request, carrier);
    const write = !SAFE_METHODS.has(context.request.method.toUpperCase());
    const resumed = write || incoming === null ? null : watched(open(incoming));
    const session = resumed?.session ?? open(write || carrier === undefined ? "first-primary" : "first-unconstrained");
    const sessions = sessionsCtx.getOptional(context) ?? new Map<D1DatabaseLike, D1DatabaseSession>();
    sessions.set(db, session);
    sessionsCtx.set(context, sessions);

    const response = await next();
    if (carrier === undefined) return response;
    if (resumed?.refused() === true) {
      if ("cookie" in carrier)
        setPendingHeader(context, "set-cookie", `${carrier.cookie}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, { append: true });
      return response;
    }
    const bookmark = session.getBookmark();
    if (bookmark === null) return response;
    if ("header" in carrier) setPendingHeader(context, carrier.header, bookmark);
    else if (bookmark !== incoming)
      setPendingHeader(context, "set-cookie", `${carrier.cookie}=${bookmark}; Path=/; HttpOnly; Secure; SameSite=Lax`, { append: true });
    return response;
  };
}
