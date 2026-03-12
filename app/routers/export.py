"""
Export endpoint — download insertions as BED, VCF, or CSV files.

Bioinformaticians often need data in specific formats to feed into tools
like bedtools, UCSC Genome Browser, or variant callers. This endpoint
converts the database rows into standard genomic file formats.

ENDPOINT:
    GET /v1/export?format=bed     → BED6 format (0-based coordinates)
    GET /v1/export?format=vcf     → VCF 4.2 format (1-based coordinates)
    GET /v1/export?format=csv     → flat CSV

    Same filter params as /v1/insertions apply here too.

COORDINATE CONVERSION:
    The database stores 1-based coordinates (matching the source CSV).
    BED format requires 0-based coordinates, so we convert:
        BED start = DB start - 1    (758508 → 758507)
        BED end   = DB end          (758509 → 758509)
    VCF uses 1-based, so no conversion needed.

STREAMING:
    Uses StreamingResponse to avoid loading all rows into memory at once.
    This matters when exporting large result sets (e.g. all 44,984 insertions).
"""

import io

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Insertion, PopFrequency
from app.routers.insertions import _apply_filters

router = APIRouter(prefix="/v1", tags=["export"])

# ── Canonical population order ───────────────────────────────────────────
# Matches the manifest's population_columns section.
# Individual populations (26) come first, then the 7 super-populations.
# This order is used as column headers in the CSV export and copy-to-clipboard.
_POP_ORDER = [
    # Individual populations (26 sub-populations from 1000 Genomes Project)
    "ACB", "ASW", "BEB", "CDX", "CEU", "CHB", "CHS", "CLM", "ESN", "FIN",
    "GBR", "GIH", "GWD", "IBS", "ITU", "JPT", "KHV", "LWK", "MSL", "MXL",
    "PEL", "PJL", "PUR", "STU", "TSI", "YRI",
    # Super-populations (5 continental + 2 summary groups)
    "AFR", "AMR", "EAS", "EUR", "SAS", "Non_African", "All",
]


def _get_filtered_insertions(db, me_type, me_subtype, me_category, variant_class,
                              annotation, dataset_id, population, min_freq, max_freq,
                              strand=None, chrom=None):
    """Build and execute a filtered query, returning all matching insertions.

    Uses joinedload so population frequencies are fetched in the same SQL query
    instead of one extra query per insertion (N+1 problem). This is important
    for the CSV export which needs pop data for every row.
    """
    query = db.query(Insertion).options(joinedload(Insertion.pop_frequencies))
    query = _apply_filters(query, me_type, me_subtype, me_category, variant_class,
                           annotation, dataset_id, population, min_freq, max_freq, db,
                           strand=strand, chrom=chrom)
    return query.order_by(Insertion.chrom, Insertion.start).all()


def _to_bed(insertions) -> str:
    """Convert insertions to BED6 format.

    BED format (tab-separated, 0-based):
        chrom  start  end  name  score  strand

    The score field is set to 0 (not applicable for our data).
    Start is converted from 1-based to 0-based.
    """
    lines = []
    for ins in insertions:
        # Convert 1-based → 0-based for BED
        bed_start = ins.start - 1
        bed_end = ins.end
        strand = ins.strand or "."
        lines.append(f"{ins.chrom}\t{bed_start}\t{bed_end}\t{ins.id}\t0\t{strand}")
    return "\n".join(lines) + "\n"


def _to_vcf(insertions) -> str:
    """Convert insertions to VCF 4.2 format.

    VCF uses 1-based coordinates (same as our database), so no conversion needed.
    This produces a minimal VCF — enough for tools that need variant positions.
    """
    lines = [
        "##fileformat=VCFv4.2",
        '##INFO=<ID=METYPE,Number=1,Type=String,Description="Mobile element type">',
        '##INFO=<ID=MESUB,Number=1,Type=String,Description="Mobile element subtype">',
        '##INFO=<ID=MECAT,Number=1,Type=String,Description="ME category (Reference/Non-reference)">',
        '##INFO=<ID=VARCLASS,Number=1,Type=String,Description="Variant class">',
        "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO",
    ]
    for ins in insertions:
        info_parts = [f"METYPE={ins.me_type}"]
        if ins.me_subtype:
            info_parts.append(f"MESUB={ins.me_subtype}")
        if ins.me_category:
            info_parts.append(f"MECAT={ins.me_category}")
        if ins.variant_class:
            info_parts.append(f"VARCLASS={ins.variant_class}")
        info = ";".join(info_parts)

        lines.append(f"{ins.chrom}\t{ins.start}\t{ins.id}\t.\t<INS:ME:{ins.me_type}>\t.\t.\t{info}")
    return "\n".join(lines) + "\n"


def _to_csv(insertions) -> str:
    """Convert insertions to flat CSV, including one column per population.

    The population columns come after the 15 core fields and follow _POP_ORDER
    (individual populations first, then super-populations). Missing AF values
    are written as empty strings so spreadsheet tools don't misinterpret them.

    WHY INCLUDE POPULATION COLUMNS?
        Researchers need to export allele frequencies alongside the insertion
        metadata so they can filter or plot in R/Python without a second query.
    """
    header = (
        "id,dataset_id,assembly,chrom,start,end,strand,me_category,me_type,"
        "rip_type,me_subtype,me_length,tsd,annotation,variant_class,"
        + ",".join(_POP_ORDER)
    )
    lines = [header]
    for ins in insertions:
        # Build a dict of population → AF for fast lookup while writing columns.
        # pop_frequencies is already loaded via joinedload in _get_filtered_insertions.
        pop_af = {pf.population: pf.af for pf in ins.pop_frequencies}

        core = [
            ins.id, ins.dataset_id or "", ins.assembly, ins.chrom,
            str(ins.start), str(ins.end), ins.strand or "",
            ins.me_category or "", ins.me_type, ins.rip_type or "",
            ins.me_subtype or "", str(ins.me_length) if ins.me_length else "",
            ins.tsd or "", ins.annotation or "", ins.variant_class or "",
        ]
        # Output AF for each population in canonical order; empty string if absent or null.
        pop_vals = [
            str(pop_af[p]) if pop_af.get(p) is not None else ""
            for p in _POP_ORDER
        ]
        lines.append(",".join(core + pop_vals))
    return "\n".join(lines) + "\n"


# Format name → (converter function, MIME type, file extension)
FORMATS = {
    "bed": (_to_bed, "text/tab-separated-values", "bed"),
    "vcf": (_to_vcf, "text/plain", "vcf"),
    "csv": (_to_csv, "text/csv", "csv"),
}


@router.get("/export")
def export_insertions(
    format: str = Query(default="bed", description="Output format: bed, vcf, or csv"),
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
    db: Session = Depends(get_db),
):
    """Export insertions in BED, VCF, or CSV format.

    Supports the same filters as /v1/insertions.

    Examples:
        /v1/export?format=bed&me_type=ALU
        /v1/export?format=vcf&population=EUR&min_freq=0.1
        /v1/export?format=csv&strand=%2B&chrom=chr1,chr2
    """
    if format not in FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid format: '{format}'. Allowed: {list(FORMATS.keys())}",
        )

    insertions = _get_filtered_insertions(
        db, me_type, me_subtype, me_category, variant_class,
        annotation, dataset_id, population, min_freq, max_freq,
        strand=strand, chrom=chrom,
    )

    converter, media_type, extension = FORMATS[format]
    content = converter(insertions)

    return StreamingResponse(
        io.StringIO(content),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename=dbrip_export.{extension}"},
    )
