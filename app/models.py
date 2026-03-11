"""
SQLAlchemy ORM models — Python classes that map to database tables.

WHAT IS AN ORM?
    ORM = Object-Relational Mapping. It lets you work with database rows as
    Python objects instead of writing raw SQL. For example:
        # Without ORM (raw SQL):
        cursor.execute("SELECT * FROM insertions WHERE id = 'A0000001'")
        row = cursor.fetchone()
        print(row[3])  # what is column 3?

        # With ORM:
        insertion = db.query(Insertion).get("A0000001")
        print(insertion.chrom)  # much clearer

WHAT IS A MODEL?
    A model is a Python class where each attribute maps to a database column.
    SQLAlchemy uses these classes to:
        - Know the table structure (columns, types, constraints)
        - Convert SQL rows ↔ Python objects automatically
        - Build SQL queries from Python code

HOW THESE MODELS RELATE TO THE REST OF THE PROJECT:
    - scripts/ingest.py creates the tables using raw SQL (it doesn't use these models)
    - app/routers/*.py uses these models to query the database via SQLAlchemy
    - The table schemas MUST match between scripts/ingest.py and these models
    - If you change a column here, you must also change it in scripts/ingest.py

THREE TABLES:
    DatasetRegistry  → tracks which datasets are loaded (id, version, row count)
    Insertion        → one row per TE insertion (44,984 rows for dbRIP)
    PopFrequency     → one row per insertion × population (1.48M rows for dbRIP)
"""

from sqlalchemy import Column, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, relationship


# ── Base class ───────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    """Base class that all models inherit from.

    SQLAlchemy uses this to keep track of all models and their tables.
    You don't interact with this class directly — just inherit from it.
    """
    pass


# ── Models ───────────────────────────────────────────────────────────────

class DatasetRegistry(Base):
    """Tracks which datasets are loaded into the database.

    When you run `python scripts/ingest.py --manifest ...`, it creates a row here.
    This lets you see what's in the DB and when it was last loaded.

    Example row:
        id="dbrip_v1", version="1.0", label="dbRIP — ...", row_count=44984
    """
    __tablename__ = "dataset_registry"

    id = Column(String, primary_key=True)          # "dbrip_v1"
    version = Column(String)                        # "1.0"
    label = Column(String)                          # human-readable name
    source_url = Column(String)                     # where the data came from
    assembly = Column(String)                       # "hg38"
    manifest = Column(Text)                         # full manifest YAML stored as JSON
    row_count = Column(Integer)                     # how many insertions were loaded
    loaded_at = Column(String)                      # ISO timestamp of last load

    # Relationships — lets you do dataset.insertions to get all rows for this dataset
    insertions = relationship("Insertion", back_populates="dataset", cascade="all, delete-orphan")


class Insertion(Base):
    """One row per TE insertion.

    This is the main table — 44,984 rows for dbRIP. Each row represents a
    transposable element insertion at a specific genomic location.

    Example row:
        id="A0000001", chrom="chr1", start=758508, end=758509,
        me_type="ALU", me_subtype="AluYc1", variant_class="Very Rare"
    """
    __tablename__ = "insertions"

    # Primary key — the dbRIP ID (e.g. "A0000001", "L0000001", "S0000001")
    id = Column(String, primary_key=True)

    # Which dataset this insertion came from (foreign key → dataset_registry)
    dataset_id = Column(String, ForeignKey("dataset_registry.id", ondelete="CASCADE"))

    # Genomic location
    assembly = Column(String, nullable=False)       # "hg38"
    chrom = Column(String, nullable=False)           # "chr1" ... "chrY"
    start = Column(Integer, nullable=False)          # 1-based (as in source CSV)
    end = Column(Integer, nullable=False)            # 1-based
    strand = Column(String)                          # "+" / "-" / NULL (~700 missing)

    # TE classification
    me_category = Column(String)                     # "Non-reference" or "Reference"
    me_type = Column(String, nullable=False)          # "ALU" / "LINE1" / "SVA" / "HERVK"
    rip_type = Column(String)                        # "NonLTR_SINE", "NonLTR_LINE", etc.
    me_subtype = Column(String)                      # "AluYa5", "L1Ta", "SVA", etc.
    me_length = Column(Integer)                      # length in base pairs

    # Annotations
    tsd = Column(String)                             # target site duplication sequence (~20% NULL)
    annotation = Column(String)                      # "INTRONIC" / "INTERGENIC" / etc. (~12% NULL)
    variant_class = Column(String)                   # "Very Rare" / "Rare" / "Low Frequency" / "Common"

    # Relationships
    dataset = relationship("DatasetRegistry", back_populates="insertions")
    pop_frequencies = relationship("PopFrequency", back_populates="insertion", cascade="all, delete-orphan")

    # Indexes — speed up common queries
    __table_args__ = (
        Index("idx_ins_region", "assembly", "chrom", "start", "end"),
        Index("idx_ins_type", "me_type"),
        Index("idx_ins_dataset", "dataset_id"),
    )


class PopFrequency(Base):
    """One row per insertion × population (long format).

    The CSV has 33 population columns (ACB, ASW, ..., All). During ingest,
    those get "melted" into this table — one row per combination of insertion
    and population. This makes it much easier to query:
        SELECT * FROM pop_frequencies WHERE population = 'EUR' AND af > 0.1

    Example rows for insertion A0000001:
        insertion_id="A0000001", population="All",  af=0.0002
        insertion_id="A0000001", population="AFR",  af=0.0028
        insertion_id="A0000001", population="EUR",  af=0.0
    """
    __tablename__ = "pop_frequencies"

    # Composite primary key — one row per (insertion, population) pair
    insertion_id = Column(String, ForeignKey("insertions.id", ondelete="CASCADE"), primary_key=True)
    population = Column(String, primary_key=True)    # "EUR", "AFR", "ACB", "All", etc.

    dataset_id = Column(String, ForeignKey("dataset_registry.id", ondelete="CASCADE"))
    af = Column(Float)                               # allele frequency 0–1

    # Relationships
    insertion = relationship("Insertion", back_populates="pop_frequencies")

    __table_args__ = (
        Index("idx_popfreq_ins", "insertion_id"),
        Index("idx_popfreq_pop", "population", "af"),
    )
