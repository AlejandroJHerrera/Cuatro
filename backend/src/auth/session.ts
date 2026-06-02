/**
 * express-session wired to a Postgres-backed store via connect-pg-simple.
 * The "session" table is auto-created on first boot (createTableIfMissing).
 *
 * Cookie config: httpOnly + sameSite=lax. localhost:3001 (frontend) and
 * localhost:4000 (backend) are same-site under the "localhost" eTLD, so lax
 * works for the dev flow. Prod will need `secure: true` and possibly
 * sameSite=none if frontend + backend end up on different registrable domains.
 */
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { env } from "../env.js";

const PgStore = connectPgSimple(session);

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export const sessionMiddleware = session({
  store: new PgStore({ pool, createTableIfMissing: true, tableName: "session" }),
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: "cuatro.sid",
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  },
});
