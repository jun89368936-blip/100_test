import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
_USE_PG = bool(DATABASE_URL)

if _USE_PG:
    import psycopg2
    import psycopg2.extras
else:
    import sqlite3
    DB_PATH = os.path.join(os.path.dirname(__file__), "rental.db")


class _Row(dict):
    """Dict-like row that also supports integer indexing (e.g. fetchone()[0])."""
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class _Cursor:
    def __init__(self, cur, use_pg):
        self._cur = cur
        self._use_pg = use_pg

    def _wrap(self, row):
        if row is None:
            return None
        if self._use_pg:
            return _Row(row)
        return _Row(zip([d[0] for d in self._cur.description], row))

    def fetchone(self):
        return self._wrap(self._cur.fetchone())

    def fetchall(self):
        rows = self._cur.fetchall()
        if self._use_pg:
            return [_Row(r) for r in rows]
        return [_Row(zip([d[0] for d in self._cur.description], r)) for r in rows]


class _Connection:
    def __init__(self, conn, use_pg):
        self._conn = conn
        self._use_pg = use_pg

    def execute(self, sql, params=()):
        if self._use_pg:
            sql = sql.replace("?", "%s")
            cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        else:
            cur = self._conn.cursor()
        cur.execute(sql, params)
        return _Cursor(cur, self._use_pg)

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()


def get_db():
    if _USE_PG:
        return _Connection(psycopg2.connect(DATABASE_URL), True)
    conn = sqlite3.connect(DB_PATH)
    return _Connection(conn, False)


def init_db():
    conn = get_db()
    if _USE_PG:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS items (
                id   SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rentals (
                id            SERIAL PRIMARY KEY,
                item_id       INTEGER NOT NULL REFERENCES items(id),
                borrower_name TEXT NOT NULL,
                rented_at     TEXT NOT NULL,
                returned_at   TEXT,
                due_date      TEXT
            )
        """)
    else:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS items (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rentals (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id       INTEGER NOT NULL,
                borrower_name TEXT NOT NULL,
                rented_at     TEXT NOT NULL,
                returned_at   TEXT,
                due_date      TEXT,
                FOREIGN KEY(item_id) REFERENCES items(id)
            )
        """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_active_rental
        ON rentals(item_id) WHERE returned_at IS NULL
    """)
    conn.commit()
    conn.close()


# IntegrityError 통합 (SQLite + PostgreSQL 모두 잡기)
_integrity_errors = [__import__("sqlite3").IntegrityError]
try:
    import psycopg2 as _pg
    _integrity_errors.append(_pg.IntegrityError)
except ImportError:
    pass
INTEGRITY_ERROR = tuple(_integrity_errors)


if __name__ == "__main__":
    init_db()
    print("DB initialized.")
