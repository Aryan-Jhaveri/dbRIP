"""
Insertion endpoints — search, get, and region queries.

These are the main endpoints bioinformaticians use to find TE insertions.
All endpoints are read-only (GET only).

ENDPOINTS:
    GET /v1/insertions              → filtered list with pagination
    GET /v1/insertions/{id}         → single insertion with population frequencies
    GET /v1/insertions/region/{assembly}/{chrom}:{start}-{end}
                                    → insertions in a genomic region

HOW FILTERING WORKS:
    Query parameters are optional filters. They stack — if you provide multiple,
    they all apply (AND logic). For example:
        /v1/insertions?me_type=ALU&variant_class=Common
    Returns only ALU insertions that are Common.

    Population-based filtering (population + min_freq/max_freq) requires a JOIN
    to the pop_frequencies table. This is the most expensive query, so it's
    only done when those parameters are provided.

HOW THIS FILE CONNECTS TO THE REST OF THE PROJECT:
    - Imports models from app/models.py (SQLAlchemy ORM classes)
    - Imports schemas from app/schemas.py (Pydantic response shapes)
    - Gets a database session from app/database.py via dependency injection
    - Registered in app/main.py as a router with prefix "/v1"
"""

import csv
import io
import re

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Insertion, PopFrequency
from app.schemas import InsertionDetail, InsertionSummary, PaginatedResponse

router = APIRouter(prefix="/v1", tags=["insertions"])


# ── Helper ───────────────────────────────────────────────────────────────

def _apply_filters(query, me_type, me_subtype, me_category, variant_class,
                   annotation, dataset_id, population, min_freq, max_freq, db,
                   strand=None, chrom=None, search=None):
    """Apply optional filters to an insertions query.

    This is shared between the list endpoint and the region endpoint so
    filtering logic isn't duplicated.

    MULTI-VALUE PARAMS (strand, chrom):
        Both accept comma-separated values, e.g. strand="+,-" or chrom="chr1,chr2".
        A single value uses an equality check (faster); multiple values use SQL IN.
        This lets the Batch Search frontend pass all selected checkboxes in one param.

    SEARCH PARAM:
        Free-text search across 8 text columns using SQL LIKE (case-insensitive via
        ilike, which SQLAlchemy maps to LIKE in SQLite). Columns are OR'd together,
        so a term like "ALU" matches any row where any of those fields contains "ALU".
        This replaces the old client-side filterRowsByRegex approach, which could only
        search the current page and produced incorrect pagination totals.
    """
    # me_type, me_category, annotation, variant_class each accept a single value
    # OR a comma-separated list (e.g. me_type=ALU,SVA).  A single value uses a
    # faster equality check; multiple values use a SQL IN clause — same pattern
    # as strand and chrom below.
    if me_type:
        values = [v.strip() for v in me_type.split(",")]
        if len(values) == 1:
            query = query.filter(Insertion.me_type == values[0])
        else:
            query = query.filter(Insertion.me_type.in_(values))
    if me_subtype:
        query = query.filter(Insertion.me_subtype == me_subtype)
    if me_category:
        values = [v.strip() for v in me_category.split(",")]
        if len(values) == 1:
            query = query.filter(Insertion.me_category == values[0])
        else:
            query = query.filter(Insertion.me_category.in_(values))
    if variant_class:
        values = [v.strip() for v in variant_class.split(",")]
        if len(values) == 1:
            query = query.filter(Insertion.variant_class == values[0])
        else:
            query = query.filter(Insertion.variant_class.in_(values))
    if annotation:
        values = [v.strip() for v in annotation.split(",")]
        if len(values) == 1:
            query = query.filter(Insertion.annotation == values[0])
        else:
            query = query.filter(Insertion.annotation.in_(values))
    if dataset_id:
        query = query.filter(Insertion.dataset_id == dataset_id)

    # Strand filter — accepts "+" | "-" | "null" or comma-separated combos.
    # "null" is stored as SQL NULL in the DB, so we translate it specially.
    if strand:
        values = [v.strip() for v in strand.split(",")]
        null_included = "null" in values
        non_null = [v for v in values if v != "null"]
        if null_included and non_null:
            # e.g. strand="+,null" → strand IN ('+') OR strand IS NULL
            query = query.filter(
                (Insertion.strand.in_(non_null)) | (Insertion.strand.is_(None))
            )
        elif null_included:
            query = query.filter(Insertion.strand.is_(None))
        elif len(non_null) == 1:
            query = query.filter(Insertion.strand == non_null[0])
        else:
            query = query.filter(Insertion.strand.in_(non_null))

    # Chrom filter — accepts "chr1" or comma-separated "chr1,chr2,chrX".
    if chrom:
        values = [v.strip() for v in chrom.split(",")]
        if len(values) == 1:
            query = query.filter(Insertion.chrom == values[0])
        else:
            query = query.filter(Insertion.chrom.in_(values))

    # Population frequency filter — requires joining the pop_frequencies table
    if population:
        query = query.join(PopFrequency, Insertion.id == PopFrequency.insertion_id)
        query = query.filter(PopFrequency.population == population)
        if min_freq is not None:
            query = query.filter(PopFrequency.af >= min_freq)
        if max_freq is not None:
            query = query.filter(PopFrequency.af <= max_freq)

    # Full-text search across key text columns — server-side LIKE filter.
    # We search 8 columns with OR logic: any match in any column returns the row.
    # ilike() is case-insensitive LIKE; SQLite maps it to LIKE (case-insensitive
    # for ASCII by default). The % wildcards match anything before/after the term.
    if search:
        term = f"%{search}%"
        query = query.filter(
            or_(
                Insertion.id.ilike(term),
                Insertion.chrom.ilike(term),
                Insertion.me_type.ilike(term),
                Insertion.me_category.ilike(term),
                Insertion.rip_type.ilike(term),
                Insertion.me_subtype.ilike(term),
                Insertion.annotation.ilike(term),
                Insertion.variant_class.ilike(term),
            )
        )

    return query


# ── Endpoints ────────────────────────────────────────────────────────────

@router.get("/insertions", response_model=PaginatedResponse)
def list_insertions(
    me_type: str | None = None,
    me_subtype: str | None = None,
    me_category: str | None = None,
    variant_class: str | None = None,
    annotation: str | None = None,
    dataset_id: str | None = None,
    population: str | None = None,
    min_freq: float | None = None,
    max_freq: float | None = None,
    strand: str | None = None,
    chrom: str | None = None,
    search: str | None = None,
    limit: int = Query(default=50, le=1000, ge=1),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """List insertions with optional filters and pagination.

    Examples:
        /v1/insertions?me_type=ALU&limit=10
        /v1/insertions?population=EUR&min_freq=0.1&variant_class=Common
        /v1/insertions?annotation=INTRONIC&me_type=LINE1
        /v1/insertions?strand=%2B            (+ must be URL-encoded)
        /v1/insertions?chrom=chr1,chr2,chrX  (comma-separated for multiple)
        /v1/insertions?search=ALU            (free-text search across key columns)
    """
    query = db.query(Insertion)
    query = _apply_filters(query, me_type, me_subtype, me_category, variant_class,
                           annotation, dataset_id, population, min_freq, max_freq, db,
                           strand=strand, chrom=chrom, search=search)

    total = query.count()
    results = query.order_by(Insertion.id).offset(offset).limit(limit).all()

    return PaginatedResponse(total=total, limit=limit, offset=offset, results=results)


@router.get("/insertions/{insertion_id}", response_model=InsertionDetail)
def get_insertion(
    insertion_id: str,
    db: Session = Depends(get_db),
):
    """Get a single insertion by ID, including all population frequencies.

    Example:
        /v1/insertions/A0000001
    """
    # joinedload tells SQLAlchemy to fetch pop_frequencies in the same query
    # instead of making a separate query when we access insertion.pop_frequencies.
    # This is called "eager loading" — it's faster than the default "lazy loading".
    insertion = (
        db.query(Insertion)
        .options(joinedload(Insertion.pop_frequencies))
        .filter(Insertion.id == insertion_id)
        .first()
    )

    if not insertion:
        raise HTTPException(status_code=404, detail=f"Insertion {insertion_id} not found")

    # Map the ORM relationship name (pop_frequencies) to the schema field name (populations)
    return InsertionDetail(
        **{c.name: getattr(insertion, c.name) for c in Insertion.__table__.columns},
        populations=insertion.pop_frequencies,
    )


@router.get("/insertions/region/{assembly}/{region}", response_model=PaginatedResponse)
def get_insertions_by_region(
    assembly: str,
    region: str,
    me_type: str | None = None,
    me_subtype: str | None = None,
    me_category: str | None = None,
    variant_class: str | None = None,
    annotation: str | None = None,
    dataset_id: str | None = None,
    population: str | None = None,
    min_freq: float | None = None,
    max_freq: float | None = None,
    strand: str | None = None,
    db: Session = Depends(get_db),
    limit: int = Query(default=50, le=1000, ge=1),
    offset: int = Query(default=0, ge=0),
):
    """Get insertions in a genomic region.

    The region format is chrom:start-end (e.g. chr1:1000000-5000000).
    The chrom filter is not available here (chrom is part of the region itself).

    Examples:
        /v1/insertions/region/hg38/chr1:1000000-5000000
        /v1/insertions/region/hg38/chr1:1000000-5000000?me_type=ALU
        /v1/insertions/region/hg38/chr1:1000000-5000000?strand=%2B
    """
    # Parse region string like "chr1:1000000-5000000"
    match = re.match(r"^(chr[\w]+):(\d+)-(\d+)$", region)
    if not match:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid region format: '{region}'. Expected format: chr1:1000000-5000000",
        )

    region_chrom = match.group(1)
    start = int(match.group(2))
    end = int(match.group(3))

    query = db.query(Insertion).filter(
        Insertion.assembly == assembly,
        Insertion.chrom == region_chrom,
        Insertion.start >= start,
        Insertion.end <= end,
    )
    query = _apply_filters(query, me_type, me_subtype, me_category, variant_class,
                           annotation, dataset_id, population, min_freq, max_freq, db,
                           strand=strand)

    total = query.count()
    results = query.order_by(Insertion.start).offset(offset).limit(limit).all()

    return PaginatedResponse(total=total, limit=limit, offset=offset, results=results)


# ── File search helpers ───────────────────────────────────────────────────

def _parse_regions_from_file(content: str) -> list[tuple[str, int, int]]:
    """Parse a BED, CSV, or TSV file and return a list of (chrom, start, end) tuples.

    SUPPORTED FORMATS:
        BED  — tab-separated, no header expected, columns: chrom start end [...]
               Coordinates are 0-based half-open [start, end).
        CSV  — comma-separated with a header row. Looks for columns named
               chrom/chr, start/chromStart, end/chromEnd (case-insensitive).
        TSV  — same as CSV but tab-separated.

    AUTO-DETECTION:
        We sniff the first non-blank, non-comment line:
          - If it looks like a standard BED row (first token starts with "chr"
            and second/third tokens are integers), we treat it as BED.
          - Otherwise we try CSV/TSV with header detection.

    WHY RETURN A LIST?
        We need to build an OR query in SQL: rows that overlap region A OR B OR C.
        Returning a list lets the caller decide how to batch the query.

    RAISES:
        ValueError if no valid rows are found or the file format is unrecognisable.
    """
    lines = [ln.rstrip() for ln in content.splitlines() if ln.strip() and not ln.startswith("#")]
    if not lines:
        raise ValueError("File is empty or contains only comments.")

    regions: list[tuple[str, int, int]] = []

    # ── BED auto-detection ────────────────────────────────────────────
    # BED files have chr... in column 0 and integers in columns 1 and 2.
    first_tokens = lines[0].split("\t")
    is_bed = (
        len(first_tokens) >= 3
        and first_tokens[0].startswith("chr")
        and first_tokens[1].lstrip("-").isdigit()
        and first_tokens[2].lstrip("-").isdigit()
    )

    if is_bed:
        for line in lines:
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            try:
                chrom, start, end = parts[0], int(parts[1]), int(parts[2])
                regions.append((chrom, start, end))
            except ValueError:
                continue  # skip malformed rows silently
        return regions

    # ── CSV / TSV header-based detection ─────────────────────────────
    # Sniff the delimiter (tab vs comma) from the first line.
    dialect = "excel-tab" if "\t" in lines[0] else "excel"
    reader = csv.DictReader(io.StringIO("\n".join(lines)), dialect=dialect)

    # Normalise column names to lowercase for case-insensitive matching.
    # Map common synonyms → canonical names.
    CHROM_ALIASES = {"chrom", "chr", "chromosome", "chromname"}
    START_ALIASES = {"start", "chromstart", "pos", "position"}
    END_ALIASES   = {"end", "chromend", "stop"}

    if reader.fieldnames is None:
        raise ValueError("Could not detect column headers in file.")

    lower_fields = {f.lower(): f for f in reader.fieldnames}

    chrom_col = next((lower_fields[k] for k in lower_fields if k in CHROM_ALIASES), None)
    start_col = next((lower_fields[k] for k in lower_fields if k in START_ALIASES), None)
    end_col   = next((lower_fields[k] for k in lower_fields if k in END_ALIASES), None)

    if not all([chrom_col, start_col, end_col]):
        raise ValueError(
            f"Could not find chrom/start/end columns. Found: {list(reader.fieldnames)}. "
            "Expected columns named chrom/chr, start/chromStart, end/chromEnd."
        )

    for row in reader:
        try:
            chrom = row[chrom_col]
            start = int(row[start_col])
            end   = int(row[end_col])
            regions.append((chrom, start, end))
        except (ValueError, KeyError):
            continue  # skip malformed rows silently

    return regions


@router.post("/insertions/file-search", response_model=PaginatedResponse)
async def file_search_insertions(
    file: UploadFile = File(...),
    window: int = Query(default=0, ge=0, description="Extend each region by ±window bp"),
    limit: int = Query(default=50, le=1000, ge=1),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """Find insertions that overlap regions listed in an uploaded BED/CSV/TSV file.

    WHAT THIS ENDPOINT DOES:
        1. Reads the uploaded file (BED, CSV, or TSV)
        2. Parses each row to get (chrom, start, end) coordinates
        3. Optionally extends each region by ±window bp
        4. Returns all insertions whose genomic coordinates overlap any of those regions

    HOW OVERLAP IS DEFINED:
        An insertion at [ins_start, ins_end] overlaps a query region [q_start, q_end] if:
            ins_start <= q_end AND ins_end >= q_start
        With window w, the query region becomes [q_start - w, q_end + w].

    FILE FORMATS:
        BED  — tab-separated, no header, columns: chrom start end [optional...]
               BED start is 0-based; we keep coordinates as-is.
        CSV  — comma-separated with header row containing chrom, start, end columns
               (common synonyms like chr/chromosome/chromStart are also recognised).
        TSV  — same as CSV but tab-separated.

    RETURNS:
        PaginatedResponse with the same structure as GET /v1/insertions.
        Results are ordered by chrom, then start position.

    EXAMPLE:
        curl -X POST /v1/insertions/file-search \\
             -F "file=@regions.bed" \\
             -F "window=500"
    """
    # Read and decode the uploaded file.
    # We decode as UTF-8 and silently replace any non-UTF-8 bytes to be
    # tolerant of files saved with different encodings.
    raw_bytes = await file.read()
    content = raw_bytes.decode("utf-8", errors="replace")

    # Parse regions from the file
    try:
        regions = _parse_regions_from_file(content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not regions:
        raise HTTPException(status_code=400, detail="No valid chrom/start/end rows found in file.")

    # Build an OR query: insertion overlaps any of the uploaded regions.
    # Overlap condition: ins.start <= q_end AND ins.end >= q_start
    # (this is the standard interval overlap check)
    overlap_conditions = [
        (Insertion.chrom == chrom)
        & (Insertion.start <= end + window)
        & (Insertion.end >= start - window)
        for chrom, start, end in regions
    ]

    query = db.query(Insertion).filter(or_(*overlap_conditions))

    total = query.count()
    results = (
        query.order_by(Insertion.chrom, Insertion.start)
        .offset(offset)
        .limit(limit)
        .all()
    )

    return PaginatedResponse(total=total, limit=limit, offset=offset, results=results)
