"""
Ingest script — loads a dataset CSV into the SQLite database.

This is a standalone script, NOT part of the API. Bioinformaticians run it
directly from the terminal to load or update data. The API (app/) never
imports this file — it only reads from the database that this script creates.

USAGE:
    # Load the full dbRIP dataset
    python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml

    # Load a corrections CSV (only updates the rows in that file)
    python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml \\
                             --csv data/raw/corrections.csv

    # Validate without writing to the database
    python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --dry-run

    # Show what datasets are currently loaded
    python scripts/ingest.py --status

    # Specify a different database file
    python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml --db my.sqlite

HOW IT WORKS:
    1. Reads the manifest YAML to find out which loader class to use
    2. Dynamically imports the loader class (e.g. ingest.dbrip.DbRIPLoader)
    3. Calls loader.run() to get (insertions, pop_frequencies) — two lists of dicts
    4. Creates the database tables if they don't exist
    5. Upserts (INSERT OR REPLACE) all rows into the database
    6. Registers the dataset in dataset_registry for tracking

WHY SQLITE + RAW SQL (not SQLAlchemy)?
    This script is meant to be simple and self-contained. A bioinformatician
    should be able to read it and understand exactly what it does. SQLAlchemy
    adds a layer of abstraction that's useful for the API but unnecessary here.
    The API uses SQLAlchemy because it needs session management, connection
    pooling, and ORM features. This script just needs INSERT statements.
"""

import argparse
import importlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add the project root to Python's import path so we can import from ingest/
# This is needed because scripts/ is a standalone directory, not a Python package.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import yaml

# ── SQL for creating tables ──────────────────────────────────────────────

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS dataset_registry (
    id          TEXT PRIMARY KEY,
    version     TEXT,
    label       TEXT,
    source_url  TEXT,
    assembly    TEXT,
    manifest    TEXT,          -- full manifest stored as JSON for reproducibility
    row_count   INTEGER,
    loaded_at   TEXT
);

CREATE TABLE IF NOT EXISTS insertions (
    id            TEXT PRIMARY KEY,
    dataset_id    TEXT REFERENCES dataset_registry(id) ON DELETE CASCADE,
    assembly      TEXT NOT NULL,
    chrom         TEXT NOT NULL,
    start         INTEGER NOT NULL,
    "end"         INTEGER NOT NULL,
    strand        TEXT,
    me_category   TEXT,
    me_type       TEXT NOT NULL,
    rip_type      TEXT,
    me_subtype    TEXT,
    me_length     INTEGER,
    tsd           TEXT,
    annotation    TEXT,
    variant_class TEXT
);

CREATE INDEX IF NOT EXISTS idx_ins_region  ON insertions (assembly, chrom, start, "end");
CREATE INDEX IF NOT EXISTS idx_ins_type    ON insertions (me_type);
CREATE INDEX IF NOT EXISTS idx_ins_dataset ON insertions (dataset_id);

CREATE TABLE IF NOT EXISTS pop_frequencies (
    insertion_id  TEXT REFERENCES insertions(id) ON DELETE CASCADE,
    dataset_id    TEXT REFERENCES dataset_registry(id) ON DELETE CASCADE,
    population    TEXT NOT NULL,
    af            REAL,
    PRIMARY KEY (insertion_id, population)
);

CREATE INDEX IF NOT EXISTS idx_popfreq_ins ON pop_frequencies (insertion_id);
CREATE INDEX IF NOT EXISTS idx_popfreq_pop ON pop_frequencies (population, af);
"""


# ── Helpers ──────────────────────────────────────────────────────────────

def load_manifest(path: str) -> dict:
    """Read and parse a manifest YAML file."""
    with open(path) as f:
        return yaml.safe_load(f)


def import_loader_class(dotted_path: str):
    """Dynamically import a class from a dotted path like 'ingest.dbrip.DbRIPLoader'.

    This is how the manifest's loader_class field gets turned into an actual
    Python class. It splits 'ingest.dbrip.DbRIPLoader' into:
        module = 'ingest.dbrip'
        class  = 'DbRIPLoader'
    Then imports the module and gets the class from it.
    """
    module_path, class_name = dotted_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


def create_tables(conn: sqlite3.Connection):
    """Create all tables and indexes if they don't already exist."""
    conn.executescript(CREATE_TABLES_SQL)


def upsert_insertions(conn: sqlite3.Connection, rows: list[dict]):
    """Insert or replace rows into the insertions table.

    INSERT OR REPLACE means: if a row with the same primary key (id) already
    exists, replace it entirely. This makes it safe to re-run the script —
    it won't create duplicates.
    """
    if not rows:
        return

    columns = list(rows[0].keys())
    placeholders = ", ".join(["?"] * len(columns))
    # Quote "end" because it's a SQL reserved word
    col_names = ", ".join(
        f'"{c}"' if c == "end" else c for c in columns
    )

    sql = f"INSERT OR REPLACE INTO insertions ({col_names}) VALUES ({placeholders})"
    values = [tuple(row[c] for c in columns) for row in rows]
    conn.executemany(sql, values)


def upsert_pop_frequencies(conn: sqlite3.Connection, rows: list[dict]):
    """Insert or replace rows into the pop_frequencies table."""
    if not rows:
        return

    sql = """
        INSERT OR REPLACE INTO pop_frequencies (insertion_id, dataset_id, population, af)
        VALUES (?, ?, ?, ?)
    """
    values = [(r["insertion_id"], r["dataset_id"], r["population"], r["af"]) for r in rows]
    conn.executemany(sql, values)


def register_dataset(conn: sqlite3.Connection, manifest: dict, row_count: int):
    """Record this dataset in the registry so we can track what's loaded."""
    sql = """
        INSERT OR REPLACE INTO dataset_registry (id, version, label, source_url, assembly, manifest, row_count, loaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """
    conn.execute(sql, (
        manifest["id"],
        manifest.get("version"),
        manifest.get("label"),
        manifest.get("source_url"),
        manifest.get("assembly"),
        json.dumps(manifest),
        row_count,
        datetime.now(timezone.utc).isoformat(),
    ))


def show_status(db_path: str):
    """Print what datasets are currently in the database."""
    if not Path(db_path).exists():
        print(f"Database {db_path} does not exist yet.")
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT id, version, label, row_count, loaded_at FROM dataset_registry").fetchall()
    conn.close()

    if not rows:
        print("No datasets loaded.")
        return

    print(f"{'ID':<15} {'Version':<10} {'Rows':>8}  {'Loaded At':<25} Label")
    print("-" * 80)
    for r in rows:
        print(f"{r['id']:<15} {r['version'] or '':<10} {r['row_count'] or 0:>8}  {r['loaded_at'] or '':<25} {r['label'] or ''}")


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Load a dataset into the dbRIP SQLite database.",
        epilog="Example: python scripts/ingest.py --manifest data/manifests/dbrip_v1.yaml",
    )
    parser.add_argument("--manifest", help="Path to the dataset manifest YAML file")
    parser.add_argument("--csv", help="Override CSV path (e.g. for a corrections file)")
    parser.add_argument("--db", default="dbrip.sqlite", help="SQLite database path (default: dbrip.sqlite)")
    parser.add_argument("--dry-run", action="store_true", help="Validate only, don't write to DB")
    parser.add_argument("--status", action="store_true", help="Show loaded datasets and exit")
    args = parser.parse_args()

    # --status: just show what's loaded and exit
    if args.status:
        show_status(args.db)
        return

    # Everything else needs a manifest
    if not args.manifest:
        parser.error("--manifest is required (unless using --status)")

    # 1. Load the manifest
    manifest = load_manifest(args.manifest)
    print(f"Dataset:  {manifest['id']} v{manifest.get('version', '?')}")
    print(f"Label:    {manifest.get('label', '')}")
    print(f"Assembly: {manifest.get('assembly', '?')}")

    # 2. Import the loader class and create an instance
    loader_class = import_loader_class(manifest["loader_class"])
    csv_override = Path(args.csv) if args.csv else None
    loader = loader_class(manifest, csv_override=csv_override)
    print(f"CSV:      {loader.csv_path}")
    print()

    # 3. Run the ETL pipeline
    print("Running ETL pipeline...")
    insertions, pop_freqs = loader.run()
    print(f"  Insertions:       {len(insertions):,} rows")
    print(f"  Pop frequencies:  {len(pop_freqs):,} rows")

    # 4. Dry run — stop here
    if args.dry_run:
        print("\n[DRY RUN] Validation passed. No data written to database.")
        return

    # 5. Write to database
    print(f"\nWriting to {args.db}...")
    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")

    try:
        create_tables(conn)
        # Register dataset FIRST — insertions and pop_frequencies reference it via foreign key
        register_dataset(conn, manifest, len(insertions))
        upsert_insertions(conn, insertions)
        upsert_pop_frequencies(conn, pop_freqs)
        conn.commit()
        print("Done.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    # 6. Verify
    print()
    show_status(args.db)


if __name__ == "__main__":
    main()
