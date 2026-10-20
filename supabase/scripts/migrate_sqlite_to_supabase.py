#!/usr/bin/env python3
"""
Migrate trip.db (SQLite, era Railway) → Supabase Postgres via PostgREST.

Semua tabel, user (officer/region/admin) dan data dipindahkan DENGAN ID ASLI
(UUID dipertahankan), jadi referensi antar-tabel tetap valid.

Usage:
  python3 migrate_sqlite_to_supabase.py \
    --db /tmp/opencode/railway-trip.db   # salinan /data/trip.db Railway (terbaru) \
    --url https://bmiruktfruunegtbydyw.supabase.co \
    --service-key eyJhbGciOi...   # dashboard → Settings → API → service_role

Wajib jalankan schema dulu: backend/migrations/001_initial_schema.sql
(di Supabase SQL Editor) — sekali saja.
"""
import argparse
import json
import sqlite3
import sys
import urllib.request
import urllib.error

# Urutan sesuai FK: parent dulu. admin_credentials terakhir (tanpa FK).
TABLE_ORDER = [
    "regions", "dermagas", "routes", "officers", "officer_dermagas",
    "officer_regions", "tariffs", "trips", "vehicles", "trip_vehicles",
    "geofences", "vehicle_plates", "region_tariffs", "plate_scans",
    "admin_credentials",
]
CONFLICT = {  # PK Supabase — dua tabel junction pakai composite key
    "officer_dermagas": "officer_id,dermaga_id",
    "officer_regions": "officer_id,region_id",
}
BATCH = 200


def rest(url, path, service_key, method="POST", body=None, on_conflict=None):
    qs = f"?on_conflict={on_conflict}" if on_conflict else ""
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}{qs}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30):
            return True, None
    except urllib.error.HTTPError as e:
        return False, f"{e.code} {e.read().decode(errors='replace')[:300]}"


def supabase_cols(url, service_key):
    req = urllib.request.Request(f"{url}/rest/v1/",
                                 headers={"apikey": service_key,
                                          "Authorization": f"Bearer {service_key}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        spec = json.load(r)
    return {t: set(d["properties"]) for t, d in spec.get("definitions", {}).items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--url", required=True)
    ap.add_argument("--service-key", required=True)
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    sb = supabase_cols(args.url, args.service_key)
    total = 0

    for table in TABLE_ORDER:
        try:
            cols = [r[1] for r in
                    con.execute(f"PRAGMA table_info({table})") if r[1] in sb.get(table, set())]
        except sqlite3.OperationalError:
            print(f"[skip] {table}: tidak ada di SQLite (device_versions dll.)")
            continue
        if not cols:
            continue
        data = [dict(r) for r in con.execute(f"SELECT * FROM {table}")]
        rows = [{k: v for k, v in d.items() if k in cols} for d in data]
        # Supabase junction tables pakai composite PK tanpa kolom id.
        if table in CONFLICT:
            for r in rows:
                r.pop("id", None)
        else:
            # ID SQLite non-UUID ("...:lokal", slug) -> UUID stabil via uuid5.
            import uuid as _uuid
            for r in rows:
                rid = str(r.get("id") or "")
                try:
                    _uuid.UUID(rid)
                except ValueError:
                    r["id"] = str(_uuid.uuid5(_uuid.NAMESPACE_URL, rid))
        # SQLite geofences tidak punya kolom `name` (NOT NULL di Supabase).
        if table == "geofences":
            for r in rows:
                if not r.get("name"):
                    r["name"] = r.get("location_name") or r.get("id")
        # SQLite geofences tidak punya kolom `name`/`dermaga_id` (wajib/ada di
        # Supabase) — gunakan location_name sebagai name.
        if table == "geofences":
            import uuid as _uuid
            for r in rows:
                if not r.get("name"):
                    r["name"] = r.get("location_name") or r.get("id")
                # ID SQLite berupa slug ("badau-d1") — Supabase butuh UUID.
                # uuid5 stabil: slug sama -> UUID sama (bisa di-upsert ulang).
                if r.get("id") and not str(r["id"]).count("-") == 4:
                    r["id"] = str(_uuid.uuid5(_uuid.NAMESPACE_URL,
                                              f"trip-geofence:{r['id']}"))
        for i in range(0, len(rows), BATCH):
            chunk = rows[i:i + BATCH]
            ok, err = rest(args.url, table, args.service_key, body=chunk,
                           on_conflict=CONFLICT.get(table, "id"))
            if not ok:
                sys.exit(f"[GAGAL] {table}@{i}: {err}")
        print(f"[ok] {table}: {len(rows)} baris")
        total += len(rows)

    print(f"Selesai. Total {total} baris dipindah ke Supabase ({args.url}).")
    print("Verifikasi: SELECT count(*) FROM trips; dst. via Table Editor.")


if __name__ == "__main__":
    main()
