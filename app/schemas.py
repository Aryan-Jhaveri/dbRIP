"""
Pydantic response schemas — define the shape of API responses (JSON).

WHY SEPARATE FROM models.py?
    models.py defines how data is STORED (Python ↔ database).
    schemas.py defines how data is SENT over HTTP (Python ↔ JSON).

    They look similar but serve different purposes:
        - models.py might have internal fields (like dataset_id foreign keys)
          that you don't want to expose in the API
        - schemas.py can combine data from multiple tables into one response
          (e.g. InsertionDetail includes population frequencies from a different table)
        - schemas.py controls validation of incoming requests too

WHAT IS from_attributes=True?
    Normally Pydantic expects a dict: {"id": "A0000001", "chrom": "chr1", ...}
    But SQLAlchemy gives us objects: insertion.id, insertion.chrom, etc.
    Setting from_attributes=True tells Pydantic "read attributes from objects,
    not just dicts". This lets us return ORM objects directly from FastAPI routes.

HOW THESE SCHEMAS ARE USED:
    In a FastAPI route, you set response_model to tell FastAPI which schema to use:

        @router.get("/insertions/{id}", response_model=InsertionDetail)
        def get_insertion(id: str, db: Session = Depends(get_db)):
            return db.query(Insertion).get(id)   # SQLAlchemy object → JSON automatically

    FastAPI takes the SQLAlchemy object, passes it through the Pydantic schema,
    and returns clean JSON to the caller. Fields not in the schema are excluded.
"""

from pydantic import BaseModel, ConfigDict


# ── Population frequency ─────────────────────────────────────────────────

class PopFrequencyOut(BaseModel):
    """One population's allele frequency for an insertion.

    Example JSON:
        {"population": "EUR", "af": 0.08}
    """
    model_config = ConfigDict(from_attributes=True)

    population: str
    af: float | None


# ── Insertion schemas ────────────────────────────────────────────────────

class InsertionSummary(BaseModel):
    """Lightweight insertion — used in list endpoints where you don't need
    all the population frequencies for every row.

    Example JSON:
        {"id": "A0000001", "chrom": "chr1", "start": 758508, "end": 758509,
         "me_type": "ALU", "me_subtype": "AluYc1", "variant_class": "Very Rare"}
    """
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str | None
    assembly: str
    chrom: str
    start: int
    end: int
    strand: str | None
    me_category: str | None
    me_type: str
    rip_type: str | None
    me_subtype: str | None
    me_length: int | None
    tsd: str | None
    annotation: str | None
    variant_class: str | None


class InsertionDetail(InsertionSummary):
    """Full insertion with population frequencies — used for single-record endpoints.

    Inherits all fields from InsertionSummary and adds the populations list.

    Example JSON:
        {"id": "A0000001", "chrom": "chr1", ...,
         "populations": [
            {"population": "All", "af": 0.0002},
            {"population": "EUR", "af": 0.0},
            {"population": "AFR", "af": 0.0028}
         ]}
    """
    # "populations" maps to the Insertion.pop_frequencies relationship in models.py
    # Pydantic reads insertion.pop_frequencies and serializes each as PopFrequencyOut
    populations: list[PopFrequencyOut] = []


# ── Paginated response ───────────────────────────────────────────────────

class PaginatedResponse(BaseModel):
    """Wrapper for list endpoints with pagination metadata.

    Example JSON:
        {"total": 44984, "limit": 50, "offset": 0,
         "results": [{...}, {...}, ...]}

    WHY PAGINATION?
        Returning all 44,984 rows at once would be slow and wasteful. Instead,
        the caller requests a page at a time (e.g. limit=50, offset=100 for
        rows 101–150). The total field tells them how many results exist so
        they can calculate how many pages there are.
    """
    total: int
    limit: int
    offset: int
    results: list[InsertionSummary]


# ── Dataset schemas ──────────────────────────────────────────────────────

class DatasetOut(BaseModel):
    """Dataset registry entry — shows what datasets are loaded.

    Example JSON:
        {"id": "dbrip_v1", "version": "1.0",
         "label": "dbRIP — Database of Retrotransposon Insertion Polymorphisms",
         "assembly": "hg38", "row_count": 44984, "loaded_at": "2024-03-11T..."}
    """
    model_config = ConfigDict(from_attributes=True)

    id: str
    version: str | None
    label: str | None
    source_url: str | None
    assembly: str | None
    row_count: int | None
    loaded_at: str | None


# ── Stats schemas ────────────────────────────────────────────────────────

class StatEntry(BaseModel):
    """A single row in a stats response.

    Example JSON:
        {"label": "ALU", "count": 33709}
    """
    label: str
    count: int


class StatsResponse(BaseModel):
    """Summary statistics grouped by a field (me_type, chrom, etc.).

    Example JSON:
        {"group_by": "me_type",
         "entries": [
            {"label": "ALU", "count": 33709},
            {"label": "LINE1", "count": 6468},
            {"label": "SVA", "count": 4697},
            {"label": "HERVK", "count": 101}
         ]}
    """
    group_by: str
    entries: list[StatEntry]
