"""
Tests for scripts/build_trackhub.py.

WHAT THESE TESTS COVER:
    The build script has two kinds of functions:
      1. Pure / file-based functions that we can test directly
      2. Functions that call external tools (sort, bedToBigBed, fetchChromSizes)
         or the live API — these are tested by mocking the subprocess/httpx calls

    Pure functions tested here:
        _strip_comments       — removes # lines and blank lines from templates
        parse_hg19_fasta      — extracts BED records from FASTA headers
        write_bed_from_records — writes (chrom, start, end, id, strand) tuples to BED6
        render_templates      — renders hub config files from templates
        write_build_meta      — writes the .build_meta.json file

    The subprocess-dependent and API-dependent functions are tested with
    unittest.mock so we don't need bedToBigBed, fetchChromSizes, or a live API.

HOW IMPORTS WORK HERE:
    build_trackhub.py is a standalone script in scripts/, not a Python package.
    We use importlib to load it by file path, which gives us the module object
    we can call and patch just like any other module.

WHAT THESE TESTS DO NOT CHECK:
    - That bedToBigBed, fetchChromSizes, or sort actually work (those are UCSC
      tools we trust; integration-testing them would need the tools installed)
    - That the live API returns correct data (that's tested in test_api.py)
    - That the hub files work in an actual UCSC browser session
"""

import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest

# ── Load build_trackhub as a module ──────────────────────────────────────
#
# build_trackhub.py is a standalone script (not in a package), so we load it
# by file path using importlib instead of a normal import statement.
# This gives us a module object (bth) we can call and monkey-patch in tests.

_script_path = Path(__file__).parent.parent / "scripts" / "build_trackhub.py"
_spec = importlib.util.spec_from_file_location("build_trackhub", _script_path)
bth = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bth)


# ── Shared fixture: minimal fake templates ────────────────────────────────

@pytest.fixture
def fake_templates(tmp_path) -> Path:
    """Create a minimal set of template files in a temp directory.

    The real templates in data/hub/templates/ have comment blocks for
    documentation. These minimal fakes have no comments so the output
    is predictable in tests.
    """
    t = tmp_path / "templates"
    t.mkdir()

    (t / "hub.txt").write_text(
        "hub dbRIP\nshortLabel dbRIP\ngenomesFile genomes.txt\n",
        encoding="utf-8",
    )
    (t / "genomes.txt").write_text(
        "genome {assembly}\ntrackDb {assembly}/trackDb.txt\n",
        encoding="utf-8",
    )
    (t / "trackDb_composite.txt").write_text(
        "track dbRIP\ncompositeTrack on\ntype bigBed 6\n",
        encoding="utf-8",
    )
    (t / "trackDb_subtrack.txt").write_text(
        "    track dbRIP_{me_type}\n"
        "    bigDataUrl {hub_url}/{assembly}/dbrip_{me_type_lower}_{assembly}.bb\n"
        "    color {color}\n",
        encoding="utf-8",
    )
    (t / "dbRIP.html").write_text(
        "<html><body>dbRIP Track Description</body></html>",
        encoding="utf-8",
    )
    return t


# ── Tests: _strip_comments ────────────────────────────────────────────────

class TestStripComments:
    """_strip_comments removes # lines and blank lines from template text."""

    def test_removes_comment_lines(self):
        text = "# this is a comment\ntrack dbRIP\n# another comment\ntype bigBed 6"
        result = bth._strip_comments(text)
        assert "# this is a comment" not in result
        assert "# another comment" not in result
        assert "track dbRIP" in result
        assert "type bigBed 6" in result

    def test_removes_blank_lines(self):
        text = "line one\n\n\nline two\n\nline three"
        result = bth._strip_comments(text)
        assert result == "line one\nline two\nline three"

    def test_empty_input(self):
        assert bth._strip_comments("") == ""

    def test_all_comments(self):
        text = "# comment 1\n# comment 2\n# comment 3\n"
        assert bth._strip_comments(text) == ""

    def test_preserves_indented_lines(self):
        # Sub-track stanzas are indented with 4 spaces — must not be stripped
        text = "    track dbRIP_ALU\n    parent dbRIP\n"
        result = bth._strip_comments(text)
        assert "    track dbRIP_ALU" in result
        assert "    parent dbRIP" in result


# ── Tests: parse_hg19_fasta ───────────────────────────────────────────────

class TestParseHg19Fasta:
    """parse_hg19_fasta extracts BED6 records from HS-ME.hg19.fa FASTA headers.

    FASTA header format (pipe-delimited):
        >ID|OrigID|Type|Chrom|Strand|f5|f6|f7|f8|f9|Start|End|...
    Fields: [0]=ID, [2]=Type, [3]=Chrom, [4]=Strand, [10]=Start(1-based), [11]=End
    """

    def _write_fasta(self, tmp_path: Path, headers: list[str]) -> Path:
        """Helper: write a minimal FASTA with the given header lines."""
        fasta = tmp_path / "test.fa"
        lines = []
        for header in headers:
            lines.append(f">{header}")
            lines.append("ACGTACGT")  # dummy sequence
        fasta.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return fasta

    def _make_header(
        self,
        ins_id="A0000001",
        orig_id="orig1",
        me_type="ALU",
        chrom="chr1",
        strand="+",
        start=100001,  # 1-based
        end=100500,
    ) -> str:
        """Build a pipe-delimited FASTA header with fields in the correct positions."""
        # Positions [5]-[9] are unused filler fields
        return f"{ins_id}|{orig_id}|{me_type}|{chrom}|{strand}|.|.|.|.|.|{start}|{end}"

    def test_basic_parse(self, tmp_path):
        fasta = self._write_fasta(tmp_path, [self._make_header()])
        records = bth.parse_hg19_fasta(fasta)

        assert "ALU" in records
        assert len(records["ALU"]) == 1

    def test_coordinate_conversion_1based_to_0based(self, tmp_path):
        """Start must be decremented by 1 (1-based → 0-based); end is unchanged."""
        fasta = self._write_fasta(tmp_path, [
            self._make_header(chrom="chr1", start=100001, end=100500)
        ])
        records = bth.parse_hg19_fasta(fasta)
        chrom, start, end, ins_id, strand = records["ALU"][0]

        assert chrom == "chr1"
        assert start == 100000    # 100001 - 1 = 0-based
        assert end   == 100500    # unchanged (BED half-open)
        assert ins_id == "A0000001"
        assert strand == "+"

    def test_groups_by_me_type(self, tmp_path):
        fasta = self._write_fasta(tmp_path, [
            self._make_header(ins_id="A0000001", me_type="ALU"),
            self._make_header(ins_id="A0000002", me_type="LINE1"),
            self._make_header(ins_id="A0000003", me_type="ALU"),
            self._make_header(ins_id="A0000004", me_type="SVA"),
        ])
        records = bth.parse_hg19_fasta(fasta)

        assert len(records["ALU"])   == 2
        assert len(records["LINE1"]) == 1
        assert len(records["SVA"])   == 1

    def test_uppercases_me_type(self, tmp_path):
        """ME type from the FASTA is normalized to uppercase."""
        fasta = self._write_fasta(tmp_path, [
            self._make_header(me_type="alu"),
            self._make_header(ins_id="A0000002", me_type="Line1"),
        ])
        records = bth.parse_hg19_fasta(fasta)

        assert "ALU"   in records
        assert "LINE1" in records
        assert "alu"   not in records
        assert "Line1" not in records

    def test_skips_malformed_headers_too_few_fields(self, tmp_path):
        """Headers with fewer than 12 pipe-separated fields are skipped."""
        fasta = self._write_fasta(tmp_path, [
            "too|few|fields|only|four",             # malformed — skipped
            self._make_header(ins_id="A0000001"),   # valid — kept
        ])
        records = bth.parse_hg19_fasta(fasta)

        assert "ALU" in records
        assert len(records["ALU"]) == 1  # only the valid header

    def test_skips_non_integer_coordinates(self, tmp_path):
        """Headers with non-numeric start/end are skipped with a warning."""
        fasta = self._write_fasta(tmp_path, [
            "A0000001|orig|ALU|chr1|+|.|.|.|.|.|notanumber|100500",
        ])
        records = bth.parse_hg19_fasta(fasta)
        # The malformed header is skipped — no ALU entries
        assert "ALU" not in records

    def test_skips_sequence_lines(self, tmp_path):
        """Lines that don't start with '>' are sequence data and must be ignored."""
        fasta = tmp_path / "test.fa"
        fasta.write_text(
            f">{self._make_header()}\n"
            "ACGTACGTACGT\n"  # sequence — must not be parsed as a header
            "ACGTACGT\n",
            encoding="utf-8",
        )
        records = bth.parse_hg19_fasta(fasta)
        assert len(records["ALU"]) == 1  # one header, not three


# ── Tests: write_bed_from_records ─────────────────────────────────────────

class TestFilterInvalidBedRows:
    """filter_invalid_bed_rows drops rows where end <= start."""

    def test_keeps_valid_rows(self, tmp_path):
        bed = tmp_path / "in.bed"
        bed.write_text("chr1\t100\t200\tA001\t0\t+\n")
        out = tmp_path / "out.bed"
        dropped = bth.filter_invalid_bed_rows(bed, out)
        assert dropped == 0
        assert out.read_text().strip() == "chr1\t100\t200\tA001\t0\t+"

    def test_drops_end_before_start(self, tmp_path):
        bed = tmp_path / "in.bed"
        bed.write_text(
            "chr1\t200\t100\tBAD\t0\t+\n"   # end < start → drop
            "chr1\t100\t200\tOK\t0\t+\n"
        )
        out = tmp_path / "out.bed"
        dropped = bth.filter_invalid_bed_rows(bed, out)
        assert dropped == 1
        lines = out.read_text().strip().splitlines()
        assert len(lines) == 1
        assert "OK" in lines[0]

    def test_drops_end_equals_start(self, tmp_path):
        bed = tmp_path / "in.bed"
        bed.write_text("chr1\t100\t100\tZERO_LEN\t0\t+\n")
        out = tmp_path / "out.bed"
        dropped = bth.filter_invalid_bed_rows(bed, out)
        assert dropped == 1
        assert out.read_text().strip() == ""

    def test_returns_count_of_dropped(self, tmp_path):
        bed = tmp_path / "in.bed"
        bed.write_text(
            "chr1\t500\t100\tBAD1\t0\t+\n"
            "chr1\t300\t100\tBAD2\t0\t+\n"
            "chr1\t100\t200\tOK\t0\t+\n"
        )
        out = tmp_path / "out.bed"
        dropped = bth.filter_invalid_bed_rows(bed, out)
        assert dropped == 2


class TestWriteBedFromRecords:
    """write_bed_from_records writes a list of tuples to a BED6 file."""

    def test_produces_tab_separated_bed6(self, tmp_path):
        output = tmp_path / "out.bed"
        bth.write_bed_from_records(
            [("chr1", 100000, 100500, "A0000001", "+")],
            output,
        )
        line = output.read_text().strip()
        cols = line.split("\t")
        assert len(cols) == 6

    def test_correct_column_values(self, tmp_path):
        output = tmp_path / "out.bed"
        bth.write_bed_from_records(
            [("chr2", 200000, 204000, "A0000002", "-")],
            output,
        )
        chrom, start, end, name, score, strand = output.read_text().strip().split("\t")
        assert chrom  == "chr2"
        assert start  == "200000"
        assert end    == "204000"
        assert name   == "A0000002"
        assert score  == "0"      # score is always 0 — BED6 requires it
        assert strand == "-"

    def test_multiple_records_one_per_line(self, tmp_path):
        output = tmp_path / "out.bed"
        records = [
            ("chr1", 100000, 100500, "A0000001", "+"),
            ("chr2", 200000, 204000, "A0000002", "-"),
            ("chr3", 300000, 305000, "A0000003", "+"),
        ]
        bth.write_bed_from_records(records, output)
        lines = [l for l in output.read_text().splitlines() if l.strip()]
        assert len(lines) == 3

    def test_empty_records(self, tmp_path):
        output = tmp_path / "out.bed"
        bth.write_bed_from_records([], output)
        assert output.read_text() == ""


# ── Tests: render_templates ───────────────────────────────────────────────

class TestRenderTemplates:
    """render_templates writes hub config files by substituting template placeholders."""

    def test_hub_txt_is_copied(self, tmp_path, fake_templates):
        output_dir = tmp_path / "hub"
        with patch.object(bth, "TEMPLATES_DIR", fake_templates):
            bth.render_templates(output_dir, ["hg38"], ["ALU"], "https://example.com/hub")
        assert (output_dir / "hub.txt").exists()
        assert "hub dbRIP" in (output_dir / "hub.txt").read_text()

    def test_genomes_txt_contains_assembly_stanza(self, tmp_path, fake_templates):
        output_dir = tmp_path / "hub"
        with patch.object(bth, "TEMPLATES_DIR", fake_templates):
            bth.render_templates(output_dir, ["hg38"], ["ALU"], "https://example.com/hub")
        genomes = (output_dir / "genomes.txt").read_text()
        assert "genome hg38" in genomes
        assert "trackDb hg38/trackDb.txt" in genomes

    def test_genomes_txt_multiple_assemblies(self, tmp_path, fake_templates):
        output_dir = tmp_path / "hub"
        with patch.object(bth, "TEMPLATES_DIR", fake_templates):
            bth.render_templates(output_dir, ["hg38", "hg19"], ["ALU"], "https://example.com/hub")
        genomes = (output_dir / "genomes.txt").read_text()
        assert "genome hg38" in genomes
        assert "genome hg19" in genomes

    def test_trackdb_contains_composite_header(self, tmp_path, fake_templates):
        output_dir = tmp_path / "hub"
        with patch.object(bth, "TEMPLATES_DIR", fake_templates):
            bth.render_templates(output_dir, ["hg38"], ["ALU"], "https://example.com/hub")
        trackdb = (output_dir / "hg38" / "trackDb.txt").read_text()
        assert "compositeTrack on" in trackdb

    def test_trackdb_contains_subtrack_per_me_type(self, tmp_path, fake_templates):
        output_dir = tmp_path / "hub"
        with patch.object(bth, "TEMPLATES_DIR", fake_templates):
            bth.render_templates(
                output_dir, ["hg38"], ["ALU", "LINE1", "SVA"], "https://example.com/hub"
            )
        trackdb = (output_dir / "hg38" / "trackDb.txt").read_text()
        assert "dbRIP_ALU"   in trackdb
        assert "dbRIP_LINE1" in trackdb
        assert "dbRIP_SVA"   in trackdb

    def test_trackdb_bigdataurl_uses_hub_url(self, tmp_path, fake_templates):
        """bigDataUrl must point to the correct public URL for the .bb file."""
        output_dir = tmp_path / "hub"
        hub_url = "https://example.com/hub"
        with patch.object(bth, "TEMPLATES_DIR", fake_templates):
            bth.render_templates(output_dir, ["hg38"], ["ALU"], hub_url)
        trackdb = (output_dir / "hg38" / "trackDb.txt").read_text()
        # Full expected URL: {hub_url}/{assembly}/dbrip_{me_type_lower}_{assembly}.bb
        assert "https://example.com/hub/hg38/dbrip_alu_hg38.bb" in trackdb

    def test_trackdb_me_type_color_applied(self, tmp_path, fake_templates):
        """Known ME types get their color from ME_TYPE_COLORS; unknown → DEFAULT_COLOR."""
        output_dir = tmp_path / "hub"
        with patch.object(bth, "TEMPLATES_DIR", fake_templates):
            bth.render_templates(
                output_dir, ["hg38"], ["ALU", "UNKNOWN_TYPE"], "https://example.com/hub"
            )
        trackdb = (output_dir / "hg38" / "trackDb.txt").read_text()
        assert bth.ME_TYPE_COLORS["ALU"] in trackdb     # 200,0,0 (red)
        assert bth.DEFAULT_COLOR in trackdb             # 100,100,100 (gray)

    def test_dbrip_html_is_copied(self, tmp_path, fake_templates):
        output_dir = tmp_path / "hub"
        with patch.object(bth, "TEMPLATES_DIR", fake_templates):
            bth.render_templates(output_dir, ["hg38"], ["ALU"], "https://example.com/hub")
        html = output_dir / "hg38" / "dbRIP.html"
        assert html.exists()
        assert "dbRIP Track Description" in html.read_text()

    def test_trailing_slash_stripped_from_hub_url(self, tmp_path, fake_templates):
        """hub_url trailing slashes must not cause double-slash in bigDataUrl."""
        output_dir = tmp_path / "hub"
        with patch.object(bth, "TEMPLATES_DIR", fake_templates):
            bth.render_templates(
                output_dir, ["hg38"], ["ALU"], "https://example.com/hub/"  # trailing slash
            )
        trackdb = (output_dir / "hg38" / "trackDb.txt").read_text()
        assert "hub//hg38" not in trackdb
        assert "hub/hg38" in trackdb


# ── Tests: write_build_meta ───────────────────────────────────────────────

class TestWriteBuildMeta:
    """write_build_meta records what was built and when in .build_meta.json."""

    def test_file_is_written(self, tmp_path):
        bth.write_build_meta(
            output_dir = tmp_path,
            api_url    = "http://localhost:8000",
            hub_url    = "https://example.com/hub",
            assemblies = ["hg38"],
            me_types   = ["ALU"],
            row_counts = {"ALU": 100},
        )
        assert (tmp_path / ".build_meta.json").exists()

    def test_json_fields(self, tmp_path):
        bth.write_build_meta(
            output_dir = tmp_path,
            api_url    = "http://localhost:8000",
            hub_url    = "https://example.com/hub",
            assemblies = ["hg38"],
            me_types   = ["ALU", "LINE1"],
            row_counts = {"ALU": 33709, "LINE1": 6958},
        )
        meta = json.loads((tmp_path / ".build_meta.json").read_text())

        assert meta["api_url"]    == "http://localhost:8000"
        assert meta["hub_url"]    == "https://example.com/hub"
        assert meta["assemblies"] == ["hg38"]
        assert meta["me_types"]   == ["ALU", "LINE1"]
        assert meta["row_counts"]["ALU"]   == 33709
        assert meta["row_counts"]["LINE1"] == 6958
        assert "built_at" in meta  # ISO-8601 timestamp

    def test_built_at_is_iso8601(self, tmp_path):
        bth.write_build_meta(tmp_path, "http://x", "https://x", ["hg38"], ["ALU"], {})
        meta = json.loads((tmp_path / ".build_meta.json").read_text())
        # ISO 8601 format contains 'T' separator and ends with timezone info
        assert "T" in meta["built_at"]


# ── Tests: check_tools ────────────────────────────────────────────────────

class TestCheckTools:
    """check_tools verifies UCSC tools are on PATH before starting a build."""

    def test_dry_run_always_passes(self):
        """In dry-run mode, UCSC tools aren't needed so check_tools returns True."""
        # Even if bedToBigBed isn't installed, dry_run=True should pass
        result = bth.check_tools(dry_run=True)
        assert result is True

    def test_missing_tool_returns_false(self, capsys):
        """If a required tool is missing from PATH, check_tools returns False."""
        with patch("shutil.which", return_value=None):
            result = bth.check_tools(dry_run=False)
        assert result is False
        # Should print installation instructions
        captured = capsys.readouterr()
        assert "bedToBigBed" in captured.out

    def test_all_tools_present_returns_true(self):
        """If both required tools are on PATH, check_tools returns True."""
        with patch("shutil.which", return_value="/usr/local/bin/bedToBigBed"):
            result = bth.check_tools(dry_run=False)
        assert result is True
