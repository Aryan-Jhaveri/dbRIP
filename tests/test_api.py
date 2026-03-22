"""
Tests for the FastAPI endpoints.

These tests use FastAPI's TestClient, which simulates HTTP requests without
actually starting a server. The tests run against a temporary SQLite database
loaded with the 5-row sample fixture.

HOW THE TEST DATABASE WORKS:
    1. conftest.py fixtures (at the bottom of this file) create a temporary
       SQLite database in memory
    2. The sample CSV is loaded into it using the ingest pipeline
    3. Each test gets a fresh database session
    4. The database is thrown away after tests finish

WHAT THESE TESTS CHECK:
    - Every endpoint returns the correct HTTP status code
    - Response shapes match the Pydantic schemas
    - Filtering works (me_type, region, population)
    - Pagination works (limit, offset, total count)
    - Export formats produce valid output (BED, VCF, CSV)
    - 404s are returned for missing resources
    - Invalid inputs return 400 errors
"""

import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.database import get_db
from app.main import app
from app.models import Base

# ── Paths ────────────────────────────────────────────────────────────────

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SAMPLE_CSV = FIXTURES_DIR / "sample.csv"
MANIFEST_PATH = Path(__file__).parent.parent / "data" / "manifests" / "dbrip_v1.yaml"


# ── Test database setup ─────────────────────────────────────────────────

@pytest.fixture(scope="session")
def test_db_path(tmp_path_factory):
    """Create a temporary SQLite database loaded with sample data.

    Uses scripts/ingest.py to load the data — this tests the full pipeline
    end-to-end, not just the API in isolation.
    """
    db_path = tmp_path_factory.mktemp("data") / "test.sqlite"
    subprocess.run(
        [
            sys.executable, "scripts/ingest.py",
            "--manifest", str(MANIFEST_PATH),
            "--csv", str(SAMPLE_CSV),
            "--db", str(db_path),
        ],
        check=True,
        capture_output=True,
    )
    return db_path


@pytest.fixture(scope="session")
def test_engine(test_db_path):
    """Create a SQLAlchemy engine pointing at the test database."""
    engine = create_engine(f"sqlite:///{test_db_path}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


@pytest.fixture(scope="session")
def test_session_factory(test_engine):
    """Create a session factory for the test database."""
    return sessionmaker(bind=test_engine, autocommit=False, autoflush=False)


@pytest.fixture()
def client(test_session_factory):
    """FastAPI test client that uses the test database instead of the real one.

    This overrides the get_db dependency so routes use our test database.
    """
    def _override_get_db():
        db = test_session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


# ── Health ───────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_returns_ok(self, client):
        r = client.get("/v1/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


# ── Insertions list ─────────────────────────────────────────────────────

class TestListInsertions:
    def test_returns_paginated_response(self, client):
        """Response should have total, limit, offset, and results."""
        r = client.get("/v1/insertions")
        assert r.status_code == 200
        data = r.json()
        assert "total" in data
        assert "limit" in data
        assert "offset" in data
        assert "results" in data
        assert data["total"] == 5

    def test_limit_works(self, client):
        r = client.get("/v1/insertions?limit=2")
        data = r.json()
        assert len(data["results"]) == 2
        assert data["total"] == 5  # total is still all matching rows

    def test_offset_works(self, client):
        r = client.get("/v1/insertions?limit=2&offset=4")
        data = r.json()
        assert len(data["results"]) == 1  # only 1 row left after offset 4

    def test_filter_by_me_type(self, client):
        r = client.get("/v1/insertions?me_type=ALU")
        data = r.json()
        assert data["total"] == 3
        for row in data["results"]:
            assert row["me_type"] == "ALU"

    def test_filter_by_variant_class(self, client):
        r = client.get("/v1/insertions?variant_class=Very Rare")
        data = r.json()
        assert data["total"] >= 1
        for row in data["results"]:
            assert row["variant_class"] == "Very Rare"

    def test_results_have_correct_fields(self, client):
        """Each result should have all InsertionSummary fields."""
        r = client.get("/v1/insertions?limit=1")
        row = r.json()["results"][0]
        expected_fields = {
            "id", "dataset_id", "assembly", "chrom", "start", "end", "strand",
            "me_category", "me_type", "rip_type", "me_subtype", "me_length",
            "tsd", "annotation", "variant_class",
        }
        assert set(row.keys()) == expected_fields


# ── Single insertion ─────────────────────────────────────────────────────

class TestGetInsertion:
    def test_returns_insertion_with_populations(self, client):
        r = client.get("/v1/insertions/A0000001")
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == "A0000001"
        assert "populations" in data
        assert len(data["populations"]) == 33

    def test_populations_have_correct_fields(self, client):
        r = client.get("/v1/insertions/A0000001")
        pop = r.json()["populations"][0]
        assert "population" in pop
        assert "af" in pop

    def test_404_for_missing_insertion(self, client):
        r = client.get("/v1/insertions/DOESNOTEXIST")
        assert r.status_code == 404


# ── Region query ─────────────────────────────────────────────────────────

class TestRegionQuery:
    def test_region_returns_insertions(self, client):
        """chr1:700000-900000 should include A0000001, L0000001, S0000001."""
        r = client.get("/v1/insertions/region/hg38/chr1:700000-900000")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] >= 1

    def test_region_with_filter(self, client):
        r = client.get("/v1/insertions/region/hg38/chr1:700000-900000?me_type=ALU")
        data = r.json()
        for row in data["results"]:
            assert row["me_type"] == "ALU"

    def test_invalid_region_format(self, client):
        r = client.get("/v1/insertions/region/hg38/invalid")
        assert r.status_code == 400

    def test_empty_region_returns_zero(self, client):
        """A region with no insertions should return total=0, not an error."""
        r = client.get("/v1/insertions/region/hg38/chr99:1-100")
        assert r.status_code == 200
        assert r.json()["total"] == 0


# ── Stats ────────────────────────────────────────────────────────────────

class TestStats:
    def test_stats_by_me_type(self, client):
        r = client.get("/v1/stats?by=me_type")
        assert r.status_code == 200
        data = r.json()
        assert data["group_by"] == "me_type"
        labels = [e["label"] for e in data["entries"]]
        assert "ALU" in labels

    def test_stats_by_variant_class(self, client):
        r = client.get("/v1/stats?by=variant_class")
        assert r.status_code == 200
        assert len(r.json()["entries"]) >= 1

    def test_invalid_group_by(self, client):
        r = client.get("/v1/stats?by=nonexistent_field")
        assert r.status_code == 400


# ── Datasets ─────────────────────────────────────────────────────────────

class TestDatasets:
    def test_list_datasets(self, client):
        r = client.get("/v1/datasets")
        assert r.status_code == 200
        datasets = r.json()
        assert len(datasets) >= 1
        assert datasets[0]["id"] == "dbrip_v1"

    def test_get_single_dataset(self, client):
        r = client.get("/v1/datasets/dbrip_v1")
        assert r.status_code == 200
        assert r.json()["id"] == "dbrip_v1"
        assert r.json()["row_count"] == 5

    def test_404_for_missing_dataset(self, client):
        r = client.get("/v1/datasets/nonexistent")
        assert r.status_code == 404


# ── Export ───────────────────────────────────────────────────────────────

class TestExport:
    def test_export_bed(self, client):
        r = client.get("/v1/export?format=bed")
        assert r.status_code == 200
        lines = r.text.strip().splitlines()
        assert len(lines) == 5  # 5 insertions

        # BED format: tab-separated, 6 fields
        fields = lines[0].split("\t")
        assert len(fields) == 6
        # First field is chrom
        assert fields[0].startswith("chr")

    def test_bed_coordinates_are_0_based(self, client):
        """BED start should be 1 less than DB start (0-based conversion)."""
        r = client.get("/v1/export?format=bed&me_type=ALU")
        lines = r.text.strip().splitlines()
        # A0000001 has DB start=758508, so BED start should be 758507
        first_line = lines[0]
        bed_start = int(first_line.split("\t")[1])
        assert bed_start == 758507

    def test_export_vcf(self, client):
        r = client.get("/v1/export?format=vcf")
        assert r.status_code == 200
        lines = r.text.strip().splitlines()
        # VCF has header lines starting with # and data lines
        header_lines = [l for l in lines if l.startswith("#")]
        data_lines = [l for l in lines if not l.startswith("#")]
        assert len(header_lines) >= 1
        assert len(data_lines) == 5

    def test_export_csv(self, client):
        r = client.get("/v1/export?format=csv")
        assert r.status_code == 200
        lines = r.text.strip().splitlines()
        assert len(lines) == 6  # header + 5 data rows
        assert "id" in lines[0]  # header has column names

    def test_export_with_filter(self, client):
        r = client.get("/v1/export?format=bed&me_type=LINE1")
        lines = r.text.strip().splitlines()
        assert len(lines) == 1  # only 1 LINE1 in sample

    def test_invalid_format(self, client):
        r = client.get("/v1/export?format=fasta")
        assert r.status_code == 400


# ── Strand filter ─────────────────────────────────────────────────────────
# Fixture strands: A0000001=+, A0000008=+, A0000116=-, L0000001=+, S0000001=-

class TestStrandFilter:
    def test_positive_strand_returns_correct_count(self, client):
        r = client.get("/v1/insertions?strand=%2B")  # + URL-encoded
        assert r.status_code == 200
        assert r.json()["total"] == 3  # A0000001, A0000008, L0000001

    def test_negative_strand_returns_correct_count(self, client):
        r = client.get("/v1/insertions?strand=-")
        assert r.status_code == 200
        assert r.json()["total"] == 2  # A0000116, S0000001

    def test_multi_strand_comma_separated(self, client):
        """Comma-separated strands should act as OR (IN clause)."""
        r = client.get("/v1/insertions?strand=%2B%2C-")  # +,- URL-encoded
        assert r.status_code == 200
        assert r.json()["total"] == 5  # all rows

    def test_strand_results_match_filter(self, client):
        """Every returned row should have the requested strand."""
        r = client.get("/v1/insertions?strand=-&limit=10")
        for row in r.json()["results"]:
            assert row["strand"] == "-"

    def test_export_with_strand_filter(self, client):
        """Export endpoint should respect the strand param."""
        r = client.get("/v1/export?format=csv&strand=-")
        lines = r.text.strip().splitlines()
        assert len(lines) == 3  # header + 2 negative-strand rows


# ── Chrom filter ──────────────────────────────────────────────────────────
# Fixture: all 5 rows are on chr1

class TestChromFilter:
    def test_single_chrom_match(self, client):
        r = client.get("/v1/insertions?chrom=chr1")
        assert r.status_code == 200
        assert r.json()["total"] == 5

    def test_single_chrom_no_match(self, client):
        r = client.get("/v1/insertions?chrom=chr99")
        assert r.status_code == 200
        assert r.json()["total"] == 0

    def test_multi_chrom_comma_separated(self, client):
        """Selecting chr1 and chr2 should return all chr1 rows (chr2 has none)."""
        r = client.get("/v1/insertions?chrom=chr1,chr2")
        assert r.status_code == 200
        assert r.json()["total"] == 5

    def test_chrom_combined_with_strand(self, client):
        """chrom and strand filters should stack (AND logic)."""
        r = client.get("/v1/insertions?chrom=chr1&strand=-")
        assert r.status_code == 200
        assert r.json()["total"] == 2  # A0000116 + S0000001

    def test_export_with_chrom_filter(self, client):
        r = client.get("/v1/export?format=csv&chrom=chr1")
        lines = r.text.strip().splitlines()
        assert len(lines) == 6  # header + 5 rows


# ── Assembly filter ──────────────────────────────────────────────────────

class TestAssemblyFilter:
    """The assembly filter lets you isolate data from a specific genome assembly.

    All sample data is hg38, so filtering by hg38 returns everything and
    filtering by a different assembly returns nothing.
    """

    def test_list_filter_by_assembly_match(self, client):
        """assembly=hg38 should return all rows (all sample data is hg38)."""
        r = client.get("/v1/insertions?assembly=hg38")
        assert r.status_code == 200
        assert r.json()["total"] == 5

    def test_list_filter_by_assembly_no_match(self, client):
        """assembly=hs1 should return 0 rows (no hs1 data in sample)."""
        r = client.get("/v1/insertions?assembly=hs1")
        assert r.status_code == 200
        assert r.json()["total"] == 0

    def test_list_no_assembly_returns_all(self, client):
        """Omitting assembly should return all rows regardless of assembly."""
        r = client.get("/v1/insertions")
        assert r.status_code == 200
        assert r.json()["total"] == 5

    def test_export_filter_by_assembly(self, client):
        """Export with assembly=hg38 returns all rows; hs1 returns header only."""
        r_hg38 = client.get("/v1/export?format=csv&assembly=hg38")
        r_hs1 = client.get("/v1/export?format=csv&assembly=hs1")
        hg38_lines = r_hg38.text.strip().splitlines()
        hs1_lines = r_hs1.text.strip().splitlines()
        assert len(hg38_lines) == 6  # header + 5 data rows
        assert len(hs1_lines) == 1   # header only

    def test_stats_filter_by_assembly(self, client):
        """Stats with assembly=hg38 should return counts; hs1 should return empty."""
        r_hg38 = client.get("/v1/stats?by=me_type&assembly=hg38")
        r_hs1 = client.get("/v1/stats?by=me_type&assembly=hs1")
        assert r_hg38.status_code == 200
        assert r_hs1.status_code == 200
        assert len(r_hg38.json()["entries"]) > 0
        assert len(r_hs1.json()["entries"]) == 0

    def test_stats_filter_by_dataset_id(self, client):
        """Stats with dataset_id filter should work."""
        r = client.get("/v1/stats?by=me_type&dataset_id=dbrip_v1")
        assert r.status_code == 200
        assert len(r.json()["entries"]) > 0

    def test_assembly_combined_with_me_type(self, client):
        """Assembly filter should stack with other filters (AND logic)."""
        r = client.get("/v1/insertions?assembly=hg38&me_type=ALU")
        assert r.status_code == 200
        assert r.json()["total"] == 3
