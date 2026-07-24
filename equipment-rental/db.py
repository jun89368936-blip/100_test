import os
from dotenv import load_dotenv

load_dotenv()

def _normalize_db_url(url):
    """호스팅 제공자별 DATABASE_URL 차이를 psycopg2가 이해하는 형태로 맞춘다.

    - postgres:// 스킴을 postgresql:// 로 통일
    - channel_binding 파라미터 제거 (Neon이 붙여주지만 psycopg2가 인식 못함)
    - sslmode 미지정 시 require 추가 (Neon/Supabase는 SSL 필수)
    """
    if not url:
        return url
    from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

    parts = urlsplit(url)
    scheme = "postgresql" if parts.scheme == "postgres" else parts.scheme
    query = [(k, v) for k, v in parse_qsl(parts.query) if k != "channel_binding"]
    if not any(k == "sslmode" for k, _ in query):
        query.append(("sslmode", "require"))
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


DATABASE_URL = _normalize_db_url(os.getenv("DATABASE_URL"))
_USE_PG = bool(DATABASE_URL)

# Neon 등 절전형 DB는 첫 연결이 깨어나는 동안 실패할 수 있어 재시도한다.
_CONNECT_RETRIES = 3
_CONNECT_BACKOFF = 2.0

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
        import time
        last_error = None
        for attempt in range(_CONNECT_RETRIES):
            try:
                return _Connection(psycopg2.connect(DATABASE_URL, connect_timeout=10), True)
            except psycopg2.OperationalError as e:
                # 호스트 자체가 없으면 재시도해도 소용없다
                if "could not translate host name" in str(e):
                    raise
                last_error = e
                if attempt < _CONNECT_RETRIES - 1:
                    time.sleep(_CONNECT_BACKOFF * (attempt + 1))
        raise last_error
    conn = sqlite3.connect(DB_PATH)
    return _Connection(conn, False)


DEFAULT_ITEMS = [
    ("드론(산업용)", "drone"),
    ("드론 1호(일반)", "drone"),
    ("드론 2호(일반)", "drone"),
    ("노트북1", "laptop"),
    ("노트북2", "laptop"),
]


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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id           SERIAL PRIMARY KEY,
                username     TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL
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
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name  TEXT NOT NULL
            )
        """)
    # 기존 유니크 인덱스 제거 (날짜 범위 겹침 체크로 대체)
    try:
        conn.execute("DROP INDEX IF EXISTS ux_active_rental")
        conn.commit()
    except Exception:
        try:
            conn._conn.rollback()
        except Exception:
            pass
    # sort_order 컬럼 추가 (기존 DB 마이그레이션)
    try:
        conn.execute("ALTER TABLE items ADD COLUMN sort_order INTEGER DEFAULT 0")
        conn.commit()
        rows = conn.execute("SELECT id FROM items ORDER BY id").fetchall()
        for idx, row in enumerate(rows):
            conn.execute("UPDATE items SET sort_order = ? WHERE id = ?", (idx, row["id"]))
        conn.commit()
    except Exception:
        try:
            conn._conn.rollback()
        except Exception:
            pass
    # cancelled_at 컬럼 추가 (기존 DB 마이그레이션)
    try:
        conn.execute("ALTER TABLE rentals ADD COLUMN cancelled_at TEXT")
        conn.commit()
    except Exception:
        try:
            conn._conn.rollback()
        except Exception:
            pass
    # 빈 DB일 때 기본 물품 자동 등록 (신규 DB 전환 시 복구용)
    try:
        if conn.execute("SELECT COUNT(*) FROM items").fetchone()[0] == 0:
            for idx, (name, item_type) in enumerate(DEFAULT_ITEMS):
                conn.execute(
                    "INSERT INTO items (name, type, sort_order) VALUES (?, ?, ?)",
                    (name, item_type, idx),
                )
            conn.commit()
    except Exception:
        try:
            conn._conn.rollback()
        except Exception:
            pass
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
