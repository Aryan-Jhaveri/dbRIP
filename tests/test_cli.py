"""
Tests for the dbrip CLI tool.

These tests mock the HTTP layer (httpx.get) so they run without a server.
They test the CLI logic: argument parsing, output formatting, error handling,
and the region shorthand parser.

HOW MOCKING WORKS:
    Instead of actually calling the API, we replace httpx.get with a fake
    function that returns canned responses. This means:
    - Tests run instantly (no network, no server needed)
    - We control exactly what the "API" returns
    - We can simulate errors (connection refused, 404, etc.)

    The @patch("cli.dbrip.httpx.get") decorator does this automatically.
    Inside each test, mock_get is the fake httpx.get — we set mock_get.return_value
    to control what it returns.

HOW TYPER TESTING WORKS:
    Typer provides a CliRunner that invokes commands programmatically and
    captures stdout/stderr. It works like FastAPI's TestClient but for CLIs.

WHAT THESE TESTS CHECK:
    - Each command produces correct output for valid responses
    - JSON output mode works (--output json)
    - Error handling: connection errors, API errors (404, 400)
    - Region shorthand parser (chr1:1M-5M → chr1:1000000-5000000)
    - Export writes to stdout or to a file
"""

import json
from unittest.mock import MagicMock, patch

import pytest
from typer.testing import CliRunner

from cli.dbrip import _parse_region_shorthand, app

# ── Setup ────────────────────────────────────────────────────────────────

runner = CliRunner()


def _mock_response(json_data=None, text="", status_code=200):
    """Create a fake httpx.Response with the given data.

    This helper builds a MagicMock that behaves like httpx.Response:
    - .status_code returns the given code
    - .json() returns the given dict
    - .text returns the given string
    """
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    resp.text = text or json.dumps(json_data or {})
    return resp


# ── Canned API responses ────────────────────────────────────────────────
#
# These mimic what the real API returns, based on the Pydantic schemas
# in app/schemas.py. We use the same field names and structure.

SEARCH_RESPONSE = {
    "total": 2,
    "limit": 50,
    "offset": 0,
    "results": [
        {
            "id": "A0000001",
            "dataset_id": "dbrip_v1",
            "assembly": "hg38",
            "chrom": "chr1",
            "start": 758508,
            "end": 758509,
            "strand": "+",
            "me_category": "Non-reference",
            "me_type": "ALU",
            "rip_type": "Non-reference",
            "me_subtype": "AluYc1",
            "me_length": 281,
            "tsd": "AAAAGAAATGAAT",
            "annotation": "INTRONIC",
            "variant_class": "Very Rare",
        },
        {
            "id": "A0000002",
            "dataset_id": "dbrip_v1",
            "assembly": "hg38",
            "chrom": "chr1",
            "start": 800000,
            "end": 800001,
            "strand": "-",
            "me_category": "Non-reference",
            "me_type": "ALU",
            "rip_type": "Non-reference",
            "me_subtype": "AluYa5",
            "me_length": 300,
            "tsd": None,
            "annotation": None,
            "variant_class": "Common",
        },
    ],
}

DETAIL_RESPONSE = {
    **SEARCH_RESPONSE["results"][0],
    "populations": [
        {"population": "All", "af": 0.0002},
        {"population": "EUR", "af": 0.0},
        {"population": "AFR", "af": 0.0028},
    ],
}

STATS_RESPONSE = {
    "group_by": "me_type",
    "entries": [
        {"label": "ALU", "count": 33709},
        {"label": "LINE1", "count": 6468},
        {"label": "SVA", "count": 4697},
    ],
}

DATASETS_RESPONSE = [
    {
        "id": "dbrip_v1",
        "version": "1.0",
        "label": "dbRIP",
        "source_url": "https://example.com",
        "assembly": "hg38",
        "row_count": 44984,
        "loaded_at": "2024-03-11T12:00:00",
    }
]


# ── Region shorthand parser tests ────────────────────────────────────────


class TestRegionParser:
    """Test the chr1:1M-5M → chr1:1000000-5000000 conversion."""

    def test_mega_suffix(self):
        assert _parse_region_shorthand("chr1:1M-5M") == "chr1:1000000-5000000"

    def test_kilo_suffix(self):
        assert _parse_region_shorthand("chr1:500K-1M") == "chr1:500000-1000000"

    def test_lowercase(self):
        assert _parse_region_shorthand("chr1:1m-5m") == "chr1:1000000-5000000"

    def test_no_suffix(self):
        """Plain numbers should pass through unchanged."""
        assert _parse_region_shorthand("chr1:100-200") == "chr1:100-200"

    def test_decimal(self):
        assert _parse_region_shorthand("chr1:1.5M-2M") == "chr1:1500000-2000000"


# ── Search command tests ─────────────────────────────────────────────────


class TestSearchCommand:

    @patch("cli.dbrip.httpx.get")
    def test_search_table_output(self, mock_get):
        """Search with default table output shows a formatted table."""
        mock_get.return_value = _mock_response(SEARCH_RESPONSE)
        result = runner.invoke(app, ["search", "--me-type", "ALU"])
        assert result.exit_code == 0
        assert "A0000001" in result.output
        assert "A0000002" in result.output
        assert "2 insertions" in result.output

    @patch("cli.dbrip.httpx.get")
    def test_search_json_output(self, mock_get):
        """--output json should return raw JSON."""
        mock_get.return_value = _mock_response(SEARCH_RESPONSE)
        result = runner.invoke(app, ["search", "--output", "json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["total"] == 2
        assert len(data["results"]) == 2

    @patch("cli.dbrip.httpx.get")
    def test_search_with_region(self, mock_get):
        """--region should call the region endpoint."""
        mock_get.return_value = _mock_response(SEARCH_RESPONSE)
        result = runner.invoke(app, ["search", "--region", "chr1:1M-5M"])
        assert result.exit_code == 0
        # Verify the URL contains the region endpoint with expanded coordinates
        call_url = mock_get.call_args[0][0]
        assert "/v1/insertions/region/hg38/chr1:1000000-5000000" in call_url

    @patch("cli.dbrip.httpx.get")
    def test_search_no_results(self, mock_get):
        """Empty results should show a friendly message."""
        mock_get.return_value = _mock_response({"total": 0, "limit": 50, "offset": 0, "results": []})
        result = runner.invoke(app, ["search"])
        assert result.exit_code == 0
        assert "No insertions matched" in result.output

    @patch("cli.dbrip.httpx.get")
    def test_search_pagination_hint(self, mock_get):
        """When there are more results, show a pagination hint."""
        response = {**SEARCH_RESPONSE, "total": 100}
        mock_get.return_value = _mock_response(response)
        result = runner.invoke(app, ["search"])
        assert result.exit_code == 0
        assert "--offset" in result.output


# ── Get command tests ────────────────────────────────────────────────────


class TestGetCommand:

    @patch("cli.dbrip.httpx.get")
    def test_get_table_output(self, mock_get):
        """Get command shows insertion details and population frequencies."""
        mock_get.return_value = _mock_response(DETAIL_RESPONSE)
        result = runner.invoke(app, ["get", "A0000001"])
        assert result.exit_code == 0
        assert "A0000001" in result.output
        assert "chr1" in result.output
        assert "ALU" in result.output
        assert "EUR" in result.output
        assert "0.0028" in result.output  # AFR frequency

    @patch("cli.dbrip.httpx.get")
    def test_get_json_output(self, mock_get):
        """--output json should return raw JSON."""
        mock_get.return_value = _mock_response(DETAIL_RESPONSE)
        result = runner.invoke(app, ["get", "A0000001", "--output", "json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["id"] == "A0000001"
        assert len(data["populations"]) == 3

    @patch("cli.dbrip.httpx.get")
    def test_get_404(self, mock_get):
        """Missing insertion should show an error."""
        mock_get.return_value = _mock_response(
            {"detail": "Insertion FAKE not found"}, status_code=404
        )
        result = runner.invoke(app, ["get", "FAKE"])
        assert result.exit_code == 1
        assert "not found" in result.output


# ── Export command tests ─────────────────────────────────────────────────


class TestExportCommand:

    @patch("cli.dbrip.httpx.get")
    def test_export_stdout(self, mock_get):
        """Export without --out writes to stdout."""
        bed_content = "chr1\t758507\t758509\tA0000001\t0\t+\n"
        mock_get.return_value = _mock_response(text=bed_content)
        result = runner.invoke(app, ["export", "--format", "bed"])
        assert result.exit_code == 0
        assert "chr1\t758507" in result.output

    @patch("cli.dbrip.httpx.get")
    def test_export_to_file(self, mock_get, tmp_path):
        """Export with --out writes to a file."""
        bed_content = "chr1\t758507\t758509\tA0000001\t0\t+\n"
        mock_get.return_value = _mock_response(text=bed_content)
        outfile = str(tmp_path / "test.bed")
        result = runner.invoke(app, ["export", "--format", "bed", "--out", outfile])
        assert result.exit_code == 0
        assert "Saved" in result.output
        with open(outfile) as f:
            assert "chr1\t758507" in f.read()


# ── Stats command tests ──────────────────────────────────────────────────


class TestStatsCommand:

    @patch("cli.dbrip.httpx.get")
    def test_stats_table_output(self, mock_get):
        """Stats shows a table with labels and counts."""
        mock_get.return_value = _mock_response(STATS_RESPONSE)
        result = runner.invoke(app, ["stats"])
        assert result.exit_code == 0
        assert "ALU" in result.output
        assert "33,709" in result.output

    @patch("cli.dbrip.httpx.get")
    def test_stats_json_output(self, mock_get):
        """--output json returns raw JSON."""
        mock_get.return_value = _mock_response(STATS_RESPONSE)
        result = runner.invoke(app, ["stats", "--output", "json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["group_by"] == "me_type"
        assert len(data["entries"]) == 3


# ── Datasets command tests ───────────────────────────────────────────────


class TestDatasetsCommand:

    @patch("cli.dbrip.httpx.get")
    def test_datasets_table_output(self, mock_get):
        """Datasets shows a table with loaded datasets."""
        mock_get.return_value = _mock_response(DATASETS_RESPONSE)
        result = runner.invoke(app, ["datasets"])
        assert result.exit_code == 0
        assert "dbrip_v1" in result.output
        assert "44,984" in result.output

    @patch("cli.dbrip.httpx.get")
    def test_datasets_json_output(self, mock_get):
        """--output json returns raw JSON."""
        mock_get.return_value = _mock_response(DATASETS_RESPONSE)
        result = runner.invoke(app, ["datasets", "--output", "json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert len(data) == 1
        assert data[0]["id"] == "dbrip_v1"

    @patch("cli.dbrip.httpx.get")
    def test_datasets_empty(self, mock_get):
        """No datasets shows a friendly message."""
        mock_get.return_value = _mock_response([])
        result = runner.invoke(app, ["datasets"])
        assert result.exit_code == 0
        assert "No datasets" in result.output


# ── Connection error tests ───────────────────────────────────────────────


class TestConnectionErrors:

    @patch("cli.dbrip.httpx.get")
    def test_connection_refused(self, mock_get):
        """When the API is down, show a helpful error message."""
        import httpx
        mock_get.side_effect = httpx.ConnectError("Connection refused")
        result = runner.invoke(app, ["search"])
        assert result.exit_code == 1
        assert "Could not connect" in result.output


# ── Assembly filter tests ────────────────────────────────────────────────


class TestAssemblyFlag:
    """The --assembly flag filters by genome assembly on search, export, and stats."""

    @patch("cli.dbrip.httpx.get")
    def test_search_assembly_passed_as_query_param(self, mock_get):
        """Without --region, --assembly should be passed as a query parameter."""
        mock_get.return_value = _mock_response(SEARCH_RESPONSE)
        result = runner.invoke(app, ["search", "--assembly", "hs1"])
        assert result.exit_code == 0
        # Check the params dict passed to httpx.get
        call_kwargs = mock_get.call_args
        params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params", {})
        assert params.get("assembly") == "hs1"

    @patch("cli.dbrip.httpx.get")
    def test_search_region_uses_assembly_in_path(self, mock_get):
        """With --region, --assembly should appear in the URL path, not params."""
        mock_get.return_value = _mock_response(SEARCH_RESPONSE)
        result = runner.invoke(app, ["search", "--region", "chr1:1M-5M", "--assembly", "hs1"])
        assert result.exit_code == 0
        call_url = mock_get.call_args[0][0]
        assert "/v1/insertions/region/hs1/" in call_url

    @patch("cli.dbrip.httpx.get")
    def test_search_region_defaults_to_hg38(self, mock_get):
        """Region search without --assembly should default to hg38."""
        mock_get.return_value = _mock_response(SEARCH_RESPONSE)
        result = runner.invoke(app, ["search", "--region", "chr1:1M-5M"])
        assert result.exit_code == 0
        call_url = mock_get.call_args[0][0]
        assert "/v1/insertions/region/hg38/" in call_url

    @patch("cli.dbrip.httpx.get")
    def test_export_assembly_passed(self, mock_get):
        """Export with --assembly should pass it as a query param."""
        mock_get.return_value = _mock_response(text="chr1\t100\t200\tA001\t0\t+\n")
        result = runner.invoke(app, ["export", "--format", "bed", "--assembly", "hg38"])
        assert result.exit_code == 0
        call_kwargs = mock_get.call_args
        params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params", {})
        assert params.get("assembly") == "hg38"

    @patch("cli.dbrip.httpx.get")
    def test_stats_assembly_passed(self, mock_get):
        """Stats with --assembly should pass it as a query param."""
        mock_get.return_value = _mock_response(STATS_RESPONSE)
        result = runner.invoke(app, ["stats", "--assembly", "hg38"])
        assert result.exit_code == 0
        call_kwargs = mock_get.call_args
        params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params", {})
        assert params.get("assembly") == "hg38"

    @patch("cli.dbrip.httpx.get")
    def test_stats_dataset_id_passed(self, mock_get):
        """Stats with --dataset-id should pass it as a query param."""
        mock_get.return_value = _mock_response(STATS_RESPONSE)
        result = runner.invoke(app, ["stats", "--dataset-id", "dbrip_v1"])
        assert result.exit_code == 0
        call_kwargs = mock_get.call_args
        params = call_kwargs.kwargs.get("params") or call_kwargs[1].get("params", {})
        assert params.get("dataset_id") == "dbrip_v1"
