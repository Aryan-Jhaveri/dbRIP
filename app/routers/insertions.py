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

import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Insertion, PopFrequency
from app.schemas import InsertionDetail, InsertionSummary, PaginatedResponse

router = APIRouter(prefix="/v1", tags=["insertions"])


# ── Helper ───────────────────────────────────────────────────────────────

def _apply_filters(query, me_type, me_subtype, me_category, variant_class,
                   annotation, dataset_id, population, min_freq, max_freq, db,
                   strand=None, chrom=None):
    """Apply optional filters to an insertions query.

    This is shared between the list endpoint and the region endpoint so
    filtering logic isn't duplicated.

    MULTI-VALUE PARAMS (strand, chrom):
        Both accept comma-separated values, e.g. strand="+,-" or chrom="chr1,chr2".
        A single value uses an equality check (faster); multiple values use SQL IN.
        This lets the Batch Search frontend pass all selected checkboxes in one param.
    """
    if me_type:
        query = query.filter(Insertion.me_type == me_type)
    if me_subtype:
        query = query.filter(Insertion.me_subtype == me_subtype)
    if me_category:
        query = query.filter(Insertion.me_category == me_category)
    if variant_class:
        query = query.filter(Insertion.variant_class == variant_class)
    if annotation:
        query = query.filter(Insertion.annotation == annotation)
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
    """
    query = db.query(Insertion)
    query = _apply_filters(query, me_type, me_subtype, me_category, variant_class,
                           annotation, dataset_id, population, min_freq, max_freq, db,
                           strand=strand, chrom=chrom)

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
