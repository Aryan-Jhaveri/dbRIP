"""
Base class for dataset loaders — the "contract" every loader must follow.

Think of this like a recipe template:
    1. load_raw()              → Read the CSV file (no changes, just raw data)
    2. normalize(df)           → Rename columns to match the DB schema and cast types.
                                 NO data is removed or "cleaned" — the original CSV
                                 values are preserved exactly as-is, including nulls.
    3. to_insertions(df)       → Turn each row into a dict for the `insertions` DB table
    4. to_pop_frequencies(df)  → Reshape the 33 population frequency columns into
                                 separate rows for the `pop_frequencies` DB table

The run() method calls steps 1–4 in order. You never override run() — you only
fill in the steps.

IMPORTANT — NO DATA IS REMOVED:
    The CSV is the source of truth. Nulls, empty strings, and unexpected values
    are loaded into the database exactly as they appear in the CSV. People maintaing the db
    decide what to do with them — the ingest pipeline does not
    make that decision for them.

WHY DO IT THIS WAY?
    Every dataset (dbRIP, euL1db, etc.) has a different CSV format, but they all
    need to go through the same steps. This base class enforces that. A new dataset
    just means writing a new subclass + a new manifest YAML. Nothing else changes.

WHAT IS A SUBCLASS?
    A subclass is a class that "inherits" from this one. It gets all the shared
    behavior for free, and only needs to fill in the parts that are specific to
    its dataset. For example, DbRIPLoader (in ingest/dbrip.py) inherits from
    BaseLoader and implements the four abstract methods above.

    # Minimal example:
    class MyLoader(BaseLoader):
        def load_raw(self):
            return pd.read_csv(self.csv_path)
        def normalize(self, df):
            ...  # rename columns, cast types — NO data removal
        def to_insertions(self, df):
            ...  # return list of dicts
        def to_pop_frequencies(self, df):
            ...  # return list of dicts

HOW IS THIS FILE USED?
    This file is imported by ingest/dbrip.py (and any future loaders).
    It is NOT imported by the API (app/) — the API only reads from the database.
    scripts/ingest.py calls loader.run() to do the actual ETL.
"""

from abc import ABC, abstractmethod
from pathlib import Path

import pandas as pd


class BaseLoader(ABC):
    """Abstract loader that every dataset-specific loader must inherit from.

    Args:
        manifest: The parsed YAML dict from data/manifests/<dataset>.yaml.
                  Contains column mappings, population columns, etc.
        csv_override: Optional path to a different CSV (e.g. a corrections file
                      with only a few fixed rows). If not given, uses the
                      csv_path from the manifest.
    """

    def __init__(self, manifest: dict, csv_override: Path | None = None):
        self.manifest = manifest

        # Where to read the CSV from
        self.csv_path = csv_override or Path(manifest["csv_path"])

        # Metadata pulled from the manifest for convenience
        self.dataset_id: str = manifest["id"]
        self.assembly: str = manifest["assembly"]

        # column_map: {"CSV Column Name": "db_column_name", ...}
        self.column_map: dict[str, str] = manifest["column_map"]

        # Population columns to melt: {"individual": [...], "super": [...]}
        self.pop_columns: dict[str, list[str]] = manifest.get("population_columns", {})

    # ── Steps that each loader must implement ────────────────────────────

    @abstractmethod
    def load_raw(self) -> pd.DataFrame:
        """Step 1: Read the CSV file as-is. No renaming, no cleaning."""

    @abstractmethod
    def normalize(self, df: pd.DataFrame) -> pd.DataFrame:
        """Step 2: Rename columns to match the DB schema and cast types.

        This is purely structural — column names change, types get cast.
        NO rows are dropped. NO values are modified or "cleaned".
        The original CSV data is preserved exactly.
        """

    @abstractmethod
    def to_insertions(self, df: pd.DataFrame) -> list[dict]:
        """Step 3: Return a list of dicts, each ready for the `insertions` table.

        Example output:
            [{"id": "A0000001", "chrom": "chr1", "start": 758508, ...}, ...]
        """

    @abstractmethod
    def to_pop_frequencies(self, df: pd.DataFrame) -> list[dict]:
        """Step 4: Reshape the wide population columns into long-format dicts.

        The CSV stores 33 population frequencies as separate columns (ACB, ASW, ..., All).
        This step "melts" them into one row per insertion × population, which is
        much easier to query in the database.

        Example — CSV (wide):
            ID         All    EUR    AFR
            A0000001   0.12   0.08   0.21

        Example output (long):
            [{"insertion_id": "A0000001", "population": "All", "af": 0.12},
             {"insertion_id": "A0000001", "population": "EUR", "af": 0.08},
             {"insertion_id": "A0000001", "population": "AFR", "af": 0.21}]
        """

    # ── Pipeline orchestrator (do NOT override this) ─────────────────────

    def run(self) -> tuple[list[dict], list[dict]]:
        """Execute the full pipeline: load → rename/cast → transform → return.

        Returns a tuple of two lists:
            - insertions:       rows for the insertions table
            - pop_frequencies:  rows for the pop_frequencies table

        This method does NOT write to the database — that's handled by
        scripts/ingest.py, which calls this method and then does the DB upsert.
        """
        df = self.load_raw()
        df = self.normalize(df)
        insertions = self.to_insertions(df)
        pop_freqs = self.to_pop_frequencies(df)
        return insertions, pop_freqs
