"""SQLite tabanlı kalıcı depo: token, kota sayaçları ve önbellek.

Sunucu yeniden başlasa bile token ve kota bilgisi kaybolmaz; böylece
Diyanet'in günlük 5 istek hakkı boşa harcanmaz.
"""
import json
import sqlite3
import threading
import time
from datetime import date
from typing import Any, Optional

from .config import DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS quota (
    day TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, endpoint)
);
CREATE TABLE IF NOT EXISTS places (
    key TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prayer (
    city_id INTEGER NOT NULL,
    date TEXT NOT NULL,          -- YYYY-MM-DD
    data TEXT NOT NULL,          -- sıkıştırılmış JSON
    PRIMARY KEY (city_id, date)
);
CREATE TABLE IF NOT EXISTS fetch_log (
    city_id INTEGER PRIMARY KEY,
    day TEXT NOT NULL            -- son başarılı çekimin günü
);
CREATE TABLE IF NOT EXISTS siri_link (
    key TEXT PRIMARY KEY,        -- telefonda üretilen rastgele anahtar (kişisel bilgi değil)
    state INTEGER NOT NULL,
    city INTEGER NOT NULL,
    tz TEXT NOT NULL,
    updated INTEGER NOT NULL
);
"""


class Store:
    def __init__(self, path=DB_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)
        self._lock = threading.Lock()

    # ---------- genel ----------
    def _exec(self, sql: str, params: tuple = ()):
        with self._lock, self._conn:
            return self._conn.execute(sql, params).fetchall()

    # ---------- anahtar/değer (token) ----------
    def kv_get(self, key: str) -> Optional[Any]:
        rows = self._exec("SELECT value FROM kv WHERE key=?", (key,))
        return json.loads(rows[0][0]) if rows else None

    def kv_set(self, key: str, value: Any) -> None:
        self._exec(
            "INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (key, json.dumps(value), int(time.time())),
        )

    def kv_delete(self, key: str) -> None:
        self._exec("DELETE FROM kv WHERE key=?", (key,))

    # ---------- kota ----------
    def quota_used(self, day: str, endpoint: str) -> int:
        rows = self._exec("SELECT count FROM quota WHERE day=? AND endpoint=?", (day, endpoint))
        return rows[0][0] if rows else 0

    def quota_inc(self, day: str, endpoint: str) -> int:
        self._exec(
            "INSERT INTO quota(day,endpoint,count) VALUES(?,?,1) "
            "ON CONFLICT(day,endpoint) DO UPDATE SET count=count+1",
            (day, endpoint),
        )
        return self.quota_used(day, endpoint)

    def quota_today(self, day: str) -> list[tuple[str, int]]:
        return [tuple(r) for r in self._exec(
            "SELECT endpoint,count FROM quota WHERE day=? ORDER BY endpoint", (day,))]

    def quota_cleanup(self, keep_from_day: str) -> None:
        self._exec("DELETE FROM quota WHERE day < ?", (keep_from_day,))

    # ---------- yer listeleri ----------
    def places_get(self, key: str, max_age_s: int) -> Optional[Any]:
        rows = self._exec("SELECT json,fetched_at FROM places WHERE key=?", (key,))
        if not rows:
            return None
        data, fetched_at = rows[0]
        if time.time() - fetched_at > max_age_s:
            return None
        return json.loads(data)

    def places_get_stale(self, key: str) -> Optional[Any]:
        """Süresi geçmiş olsa da kayıt varsa döndür (kota bittiğinde yedek)."""
        rows = self._exec("SELECT json FROM places WHERE key=?", (key,))
        return json.loads(rows[0][0]) if rows else None

    def places_set(self, key: str, value: Any) -> None:
        self._exec(
            "INSERT INTO places(key,json,fetched_at) VALUES(?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET json=excluded.json, fetched_at=excluded.fetched_at",
            (key, json.dumps(value, ensure_ascii=False), int(time.time())),
        )

    # ---------- namaz vakitleri ----------
    def prayer_get_range(self, city_id: int, start: date, end: date) -> list[dict]:
        rows = self._exec(
            "SELECT data FROM prayer WHERE city_id=? AND date>=? AND date<=? ORDER BY date",
            (city_id, start.isoformat(), end.isoformat()),
        )
        return [json.loads(r[0]) for r in rows]

    def prayer_put_many(self, city_id: int, days: list[dict]) -> None:
        with self._lock, self._conn:
            self._conn.executemany(
                "INSERT INTO prayer(city_id,date,data) VALUES(?,?,?) "
                "ON CONFLICT(city_id,date) DO UPDATE SET data=excluded.data",
                [(city_id, d["d"], json.dumps(d, ensure_ascii=False)) for d in days],
            )

    def prayer_cleanup(self, before: date) -> int:
        """Geçmiş günleri sunucu önbelleğinden de sil."""
        with self._lock, self._conn:
            cur = self._conn.execute("DELETE FROM prayer WHERE date < ?", (before.isoformat(),))
            return cur.rowcount

    def fetch_day_get(self, city_id: int) -> Optional[str]:
        rows = self._exec("SELECT day FROM fetch_log WHERE city_id=?", (city_id,))
        return rows[0][0] if rows else None

    # ---------- Siri: uygulamadaki ilçe
    def link_set(self, key: str, state: int, city: int, tz: str) -> None:
        self._exec(
            "INSERT INTO siri_link(key,state,city,tz,updated) VALUES(?,?,?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET state=excluded.state, city=excluded.city, "
            "tz=excluded.tz, updated=excluded.updated",
            (key, state, city, tz, int(time.time())),
        )

    def link_get(self, key: str):
        rows = self._exec("SELECT state,city,tz FROM siri_link WHERE key=?", (key,))
        return rows[0] if rows else None

    def link_cleanup(self, max_age_days: int = 400) -> None:
        self._exec("DELETE FROM siri_link WHERE updated < ?", (int(time.time()) - max_age_days * 86400,))

    def fetch_day_set(self, city_id: int, day: str) -> None:
        self._exec(
            "INSERT INTO fetch_log(city_id,day) VALUES(?,?) "
            "ON CONFLICT(city_id) DO UPDATE SET day=excluded.day",
            (city_id, day),
        )
