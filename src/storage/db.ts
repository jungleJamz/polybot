import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(__dirname, "..", "polybot.db");
const db = new Database(DB_PATH);

// Enable WAL mode — faster writes, safe concurrent reads
db.pragma("journal_mode = WAL");

db.exec(`
    CREATE TABLE IF NOT EXISTS active_maker_orders (
      order_id              TEXT PRIMARY KEY,
      token_id              TEXT NOT NULL,
      market_slug           TEXT NOT NULL,
      event_slug            TEXT NOT NULL,
      sport                 TEXT NOT NULL,
      market_type           TEXT NOT NULL,
      outcome               INTEGER NOT NULL,
      target_price          REAL NOT NULL,
      size                  REAL NOT NULL,
      ev_at_placement       REAL NOT NULL,
      fair_prob_at_placement REAL NOT NULL,
      bookmakers_used       TEXT NOT NULL,
      placed_at             TEXT NOT NULL,
      event_start_time      TEXT
    );

    CREATE TABLE IF NOT EXISTS wagers (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id              TEXT NOT NULL,
      token_id              TEXT NOT NULL,
      market_slug           TEXT NOT NULL,
      event_slug            TEXT NOT NULL,
      sport                 TEXT NOT NULL,
      market_type           TEXT NOT NULL,
      outcome               INTEGER NOT NULL,
      side                  TEXT NOT NULL,
      order_type            TEXT NOT NULL,
      price                 REAL NOT NULL,
      size_filled           REAL NOT NULL,
      ev_at_placement       REAL NOT NULL,
      fair_prob_at_placement REAL NOT NULL,
      bookmakers_used       TEXT NOT NULL,
      event_start_time      TEXT,
      closing_fair_prob     REAL,
      clv                   REAL,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

export default db;
