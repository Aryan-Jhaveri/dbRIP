"""
Tests for the ingest pipeline (base.py + dbrip.py).

These tests use tests/fixtures/sample.csv — a 5-row subset of the real dbRIP CSV.
The sample includes:
    - 3 ALU, 1 LINE1, 1 SVA (covers multiple ME types)
    - 2 rows with empty TSD (null preservation)
    - 1 row with empty Annotation (null preservation)

WHAT THESE TESTS CHECK:
    - The loader produces the right number of rows (no rows dropped)
    - Columns are renamed correctly (CSV names → DB names)
    - Population columns are melted into long format (33 pops × 5 rows = 165)
    - Nulls are preserved, not silently removed
    - The base class can't be instantiated directly (it's abstract)

WHAT THESE TESTS DO NOT CHECK:
    - Specific data values (those belong to the CSV, not the loader)
    - Database writes (that's scripts/ingest.py's job, tested separately)

IF THE CSV FORMAT CHANGES:
    These tests are specific to DbRIPLoader and the dbRIP CSV format.
    If a future dataset has different columns, you'd write a new loader subclass
    and new tests for it. These tests would still pass because sample.csv is
    pinned to the current dbRIP format.
"""

import math
from pathlib import Path

import pytest
import yaml

from ingest.base import BaseLoader
from ingest.dbrip import DbRIPLoader

# ── Paths ────────────────────────────────────────────────────────────────

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SAMPLE_CSV = FIXTURES_DIR / "sample.csv"
MANIFEST_PATH = Path(__file__).parent.parent / "data" / "manifests" / "dbrip_v1.yaml"


# ── Helpers ──────────────────────────────────────────────────────────────

@pytest.fixture
def manifest():
    """Load the real manifest YAML."""
    with open(MANIFEST_PATH) as f:
        return yaml.safe_load(f)


@pytest.fixture
def loader(manifest):
    """Create a DbRIPLoader pointed at the sample CSV (not the full 45K-row file)."""
    return DbRIPLoader(manifest, csv_override=SAMPLE_CSV)


@pytest.fixture
def results(loader):
    """Run the full pipeline and return (insertions, pop_frequencies)."""
    return loader.run()


# ── BaseLoader tests ─────────────────────────────────────────────────────

class TestBaseLoader:
    """Verify the abstract base class enforces the contract."""

    def test_cannot_instantiate_directly(self, manifest):
        """BaseLoader is abstract — you must subclass it."""
        with pytest.raises(TypeError):
            BaseLoader(manifest)


# ── DbRIPLoader tests ───────────────────────────────────────────────────

class TestDbRIPLoaderInsertions:
    """Tests for to_insertions() — the rows that go into the insertions table."""

    def test_row_count_matches_csv(self, results):
        """No rows should be dropped. 5 rows in sample.csv → 5 insertions."""
        insertions, _ = results
        assert len(insertions) == 5

    def test_columns_are_renamed(self, results):
        """CSV column names (e.g. 'Chromosome') should become DB names (e.g. 'chrom')."""
        insertions, _ = results
        row = insertions[0]

        # These are the DB column names (from the manifest's column_map values)
        expected_columns = {
            "id", "chrom", "start", "end", "me_category", "me_type",
            "rip_type", "me_subtype", "me_length", "strand", "tsd",
            "annotation", "variant_class", "dataset_id", "assembly",
        }
        assert set(row.keys()) == expected_columns

    def test_dataset_id_and_assembly_tagged(self, results):
        """Every row should be tagged with dataset_id and assembly from the manifest."""
        insertions, _ = results
        for row in insertions:
            assert row["dataset_id"] == "dbrip_v1"
            assert row["assembly"] == "hg38"

    def test_coordinates_are_integers(self, results):
        """start, end, and me_length should be integers (or nullable int), not strings."""
        insertions, _ = results
        for row in insertions:
            assert isinstance(row["start"], (int,)), f"start is {type(row['start'])}"
            assert isinstance(row["end"], (int,)), f"end is {type(row['end'])}"

    def test_multiple_me_types_present(self, results):
        """The sample should contain ALU, LINE1, and SVA."""
        insertions, _ = results
        me_types = {row["me_type"] for row in insertions}
        assert "ALU" in me_types
        assert "LINE1" in me_types
        assert "SVA" in me_types


class TestDbRIPLoaderPopFrequencies:
    """Tests for to_pop_frequencies() — the melted population frequency rows."""

    def test_row_count_is_rows_times_populations(self, results):
        """5 CSV rows × 33 populations = 165 pop_frequency rows."""
        _, pop_freqs = results
        assert len(pop_freqs) == 5 * 33

    def test_long_format_columns(self, results):
        """Each pop_frequency row should have insertion_id, population, af, dataset_id."""
        _, pop_freqs = results
        row = pop_freqs[0]
        assert set(row.keys()) == {"insertion_id", "population", "af", "dataset_id"}

    def test_all_populations_present(self, results, manifest):
        """All 33 population names from the manifest should appear."""
        _, pop_freqs = results
        pop_names = {row["population"] for row in pop_freqs}

        expected = set(
            manifest["population_columns"]["individual"]
            + manifest["population_columns"]["super"]
        )
        assert pop_names == expected

    def test_frequencies_are_numeric(self, results):
        """Allele frequencies should be floats (or None), not strings."""
        _, pop_freqs = results
        for row in pop_freqs:
            assert row["af"] is None or isinstance(row["af"], float), (
                f"af is {type(row['af'])}: {row['af']}"
            )


class TestNullPreservation:
    """Verify that nulls in the CSV are NOT silently removed.

    NOTE: pandas reads empty CSV fields as float('nan'), not None or "".
    So we check for all three: None, "", and nan. The important thing is
    that the ROW is still present — the null wasn't used as a reason to drop it.
    """

    @staticmethod
    def _is_missing(value) -> bool:
        """Check if a value represents missing data (None, "", or NaN)."""
        if value is None or value == "":
            return True
        if isinstance(value, float) and math.isnan(value):
            return True
        return False

    def test_empty_tsd_preserved(self, results):
        """Rows with empty TSD in the CSV should still be present."""
        insertions, _ = results
        # A0000008 and L0000001 have empty TSD in sample.csv
        ids_with_null_tsd = [
            row["id"] for row in insertions if self._is_missing(row["tsd"])
        ]
        assert len(ids_with_null_tsd) >= 2, (
            f"Expected at least 2 rows with null/empty TSD, got {len(ids_with_null_tsd)}"
        )

    def test_empty_annotation_preserved(self, results):
        """Rows with empty Annotation in the CSV should still be present."""
        insertions, _ = results
        # A0000116 has empty Annotation in sample.csv
        ids_with_null_annot = [
            row["id"] for row in insertions if self._is_missing(row["annotation"])
        ]
        assert len(ids_with_null_annot) >= 1, (
            f"Expected at least 1 row with null/empty Annotation, got {len(ids_with_null_annot)}"
        )

    def test_total_rows_unchanged(self, results):
        """All 5 rows should be present — none removed due to nulls."""
        insertions, _ = results
        assert len(insertions) == 5
