import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { ORDER_STATUSES } from "./types";

// Rendered into the orders.status CHECK constraint (single source of truth).
const STATUS_LIST = ORDER_STATUSES.map((x) => `'${x}'`).join(", ");

// Column lists shared by the routes and the engine. PUBLIC omits customer_phone
// (never returned to clients); FULL includes it (the call feature needs it, but
// responses either use PUBLIC or strip it, so it reaches a client only via the
// CALL side effect).
export const ORDER_COLS_PUBLIC =
  "id, rider_id, status, pickup_name, pickup_lat, pickup_lng, drop_name, drop_lat, drop_lng, distance_km, earnings, cod_amount, customer_name, created_at";
export const ORDER_COLS_FULL = `${ORDER_COLS_PUBLIC}, customer_phone`;

// A single pooled connection. We DON'T connect at import time, so the app
// (and its static/keyless screens) boot fine even with no database reachable.
let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Keep failures fast so an API route degrades quickly instead of hanging.
      connectionTimeoutMillis: 4000,
      max: 5,
    });
    // An idle, already-connected client can later emit 'error' (db restart,
    // killed connection). Without a listener Node rethrows it as an uncaught
    // exception and the web process dies. Swallow + log instead.
    pool.on("error", (e) => console.error("[pg pool]", e));
  }
  return pool;
}

// Idempotent schema + seed. Safe to call on every request; it only does real
// work once per process and only seeds when the orders table is empty.
export async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const p = getPool();
      await p.query(`
        CREATE TABLE IF NOT EXISTS riders (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          city        TEXT NOT NULL,
          phone       TEXT NOT NULL,
          lang_pref   TEXT NOT NULL DEFAULT 'en',
          available   BOOLEAN NOT NULL DEFAULT true
        );
        CREATE TABLE IF NOT EXISTS orders (
          id            TEXT PRIMARY KEY,
          rider_id      TEXT REFERENCES riders(id),
          status        TEXT NOT NULL DEFAULT 'AVAILABLE',
          pickup_name   TEXT NOT NULL,
          pickup_lat    DOUBLE PRECISION NOT NULL,
          pickup_lng    DOUBLE PRECISION NOT NULL,
          drop_name     TEXT NOT NULL,
          drop_lat      DOUBLE PRECISION NOT NULL,
          drop_lng      DOUBLE PRECISION NOT NULL,
          distance_km   DOUBLE PRECISION NOT NULL,
          earnings      INTEGER NOT NULL,
          cod_amount    INTEGER NOT NULL DEFAULT 0,
          customer_name TEXT NOT NULL,
          customer_phone TEXT NOT NULL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_id);
        CREATE TABLE IF NOT EXISTS transactions (
          id          TEXT PRIMARY KEY,
          order_id    TEXT NOT NULL REFERENCES orders(id),
          amount      INTEGER NOT NULL,
          method      TEXT NOT NULL DEFAULT 'CASH',
          recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_txn_order ON transactions(order_id);
        CREATE TABLE IF NOT EXISTS task_events (
          id          BIGSERIAL PRIMARY KEY,
          order_id    TEXT,
          event_type  TEXT NOT NULL,
          payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_events_order ON task_events(order_id);
      `);
      // Named status constraint applied idempotently — CREATE TABLE IF NOT EXISTS
      // won't add a CHECK to a table from an existing volume, so enforce it here.
      await p.query(`
        DO $$ BEGIN
          ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (${STATUS_LIST}));
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      `);

      const { rows } = await p.query<{ n: string }>(`SELECT count(*)::text AS n FROM orders`);
      if (rows[0]?.n === "0") {
        await seed(p);
      }
    })().catch((e) => {
      // Reset so a later request can retry (e.g. DB still starting up).
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

async function seed(p: Pool): Promise<void> {
  // Real-ish Bengaluru coordinates so the geofence math (Part 2) is meaningful.
  const orders: Array<[string, string, number, number, string, number, number, number, number, number, string, string]> = [
    ["ord_1001", "Indiranagar", 12.9719, 77.6412, "Domlur", 12.9609, 77.6387, 1.3, 62, 320, "Priya", "+91 90000 11111"],
    ["ord_1002", "Koramangala", 12.9352, 77.6245, "HSR Layout", 12.9116, 77.6389, 3.0, 48, 250, "Arjun", "+91 90000 22222"],
    ["ord_1003", "Jayanagar", 12.925, 77.5938, "BTM Layout", 12.9166, 77.6101, 2.0, 44, 180, "Sana", "+91 90000 33333"],
  ];
  // One transaction: either the whole seed lands or none of it does, so a retry
  // never sees a partial table and skips the rest.
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO riders (id, name, city, phone, lang_pref, available)
       VALUES ('rider_ravi', 'Ravi Kumar', 'Bengaluru', '+91 90000 00001', 'kn', true)
       ON CONFLICT (id) DO NOTHING`
    );
    for (const o of orders) {
      await client.query(
        `INSERT INTO orders
          (id, status, pickup_name, pickup_lat, pickup_lng, drop_name, drop_lat, drop_lng, distance_km, earnings, cod_amount, customer_name, customer_phone)
         VALUES ($1,'AVAILABLE',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO NOTHING`,
        o
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Thin typed query helper that guarantees the schema exists first.
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  if (!isDbConfigured()) throw new Error("DATABASE_URL is not configured");
  await ensureSchema();
  return getPool().query<T>(text, params as unknown[]);
}

// Run several statements atomically on one client. Used where a multi-write must
// be all-or-nothing (e.g. mark an order PAID *and* record its cash together).
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!isDbConfigured()) throw new Error("DATABASE_URL is not configured");
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
