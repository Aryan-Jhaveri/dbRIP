# Concepts

Background for lab members who are new to the technologies and biology in this project. If you already know this material, skip to [Architecture](architecture.md).

---

## 1. Transposable elements (the biology)

Transposable elements (TEs) are DNA sequences that copy themselves and insert into new genomic locations. They make up nearly half of the human genome.

Retrotransposons move by a "copy-and-paste" mechanism: they are transcribed into RNA, reverse-transcribed back into DNA, and inserted at a new location. The original copy stays in place.

### TE families in dbRIP

| Family | Full name | Typical length | Notes |
|--------|-----------|---------------|-------|
| ALU | Alu SINE elements | ~300 bp | Most abundant TE in humans. Named after the AluI restriction enzyme. |
| LINE1 | Long Interspersed Nuclear Element 1 | ~6,000 bp | The only autonomously active TE in humans. Encodes its own reverse transcriptase. |
| SVA | SINE-VNTR-Alu hybrid | ~2,000 bp | Composite element made of parts from other TEs. Youngest TE family in humans. |
| HERVK | Human Endogenous Retrovirus K | ~9,500 bp | Remnants of ancient retroviral infections. Most are inactive. |

Run `dbrip stats --by me_type` or `GET /v1/stats?by=me_type` to see current counts.

### What is a "retrotransposon insertion polymorphism" (RIP)?

A polymorphism means the insertion exists in some people but absent in others.

- `ME_category = Non-reference`: the insertion is found in population sequencing data but absent from the hg38 reference genome. This is what makes it scientifically interesting.
- `ME_category = Reference`: the insertion is in the hg38 reference genome.

**Read:** [dbRIP paper (PubMed)](https://pubmed.ncbi.nlm.nih.gov/16381958/)

---

## 2. Genomic coordinates

The CSV uses **1-based** coordinates. Different tools use different systems:

```
DNA:      A  T  G  C  A
1-based:  1  2  3  4  5   <- VCF, GFF3, the CSV, UCSC display
0-based:  0  1  2  3  4   <- BED, Python strings, SAM/BAM
```

In dbRIP data: `Start=758508, End=758509` represents one base, the point of insertion.

The database stores 1-based as-is. BED export converts at the boundary:

```python
bed_start = db_start - 1   # 758508 -> 758507
bed_end   = db_end          # 758509 -> 758509
```

**Read:** [UCSC coordinate systems](https://genome-blog.soe.ucsc.edu/blog/2016/12/12/the-ucsc-genome-browser-coordinate-counting-systems/)

---

## 3. Population genetics (the 33 columns)

The allele frequencies come from the **1000 Genomes Project**, which sequenced individuals from 26 global populations grouped into 5 super-populations:

```
Super-populations -> individual populations
---------------------------------------------
AFR (African)      ACB  ASW  ESN  GWD  LWK  MSL  YRI
EUR (European)     CEU  FIN  GBR  IBS  TSI
EAS (East Asian)   CHB  CHS  CDX  JPT  KHV
SAS (South Asian)  BEB  GIH  ITU  PJL  STU
AMR (Am. Admixed)  CLM  MXL  PEL  PUR
---------------------------------------------
Aggregates:  All   Non_African
```

The 26 wide columns in the CSV get melted into the `pop_frequencies` table during ingest:

```
# In the CSV (wide):
ID        All    EUR    AFR    ...
A0000001  0.12   0.08   0.21   ...

# In the DB (long, much easier to query):
insertion_id  population  af
A0000001      All         0.12
A0000001      EUR         0.08
A0000001      AFR         0.21
```

**Read:** [1000 Genomes overview](https://www.internationalgenome.org/about)

---

## 4. ETL and the ingest pipeline

ETL = Extract, Transform, Load.

```
Extract   -> read the CSV as-is (pandas)
Transform -> rename columns, cast types, melt population columns
Load      -> write to DB (drop + recreate tables, bulk insert)
```

The **manifest YAML** (`data/manifests/dbrip_v1.yaml`) describes what the CSV looks like. The **loader class** (`ingest/dbrip.py`) does the transform. This separation keeps the system modular: a new dataset gets a new manifest + a new loader, nothing else changes.

**Read:** [pandas read_csv docs](https://pandas.pydata.org/docs/reference/api/pandas.read_csv.html) (reference as needed)

---

## 5. REST APIs

An API lets programs talk to your database over HTTP without needing direct DB access.

```
Researcher script / Claude / bedtools pipeline
         |
         |   GET /v1/insertions?me_type=ALU&population=EUR
         v
    FastAPI server  -->  SQLite/PostgreSQL  -->  returns rows as JSON
```

The API in this project is read-only. It answers questions. It does not manage data.

| Term | What it means | Example |
|------|--------------|---------|
| Endpoint | URL that does one thing | `/v1/insertions` |
| GET | Read data | `GET /v1/insertions/A0000001` |
| POST | Send data | `POST /v1/insertions/file-search` (upload a BED file) |
| Query param | Filter in URL | `?me_type=ALU&limit=50` |
| Status code | Did it work? | 200=ok, 404=not found |

FastAPI generates interactive docs at `/docs` automatically.

**Read:** [FastAPI first steps](https://fastapi.tiangolo.com/tutorial/first-steps/)

---

## 6. SQL for bioinformaticians

The database is directly accessible. Bioinformaticians can query it without the API.

```sql
-- Count by TE family
SELECT me_type, COUNT(*) FROM insertions GROUP BY me_type ORDER BY 2 DESC;

-- Insertions in a region
SELECT * FROM insertions
WHERE chrom = 'chr1' AND start BETWEEN 1000000 AND 5000000;

-- Common EUR insertions
SELECT i.id, i.me_type, i.me_subtype, p.af
FROM insertions i
JOIN pop_frequencies p ON p.insertion_id = i.id
WHERE p.population = 'EUR' AND p.af > 0.10
ORDER BY p.af DESC;
```

**Read:**
- [SQLite tutorial (first 5 pages)](https://www.sqlitetutorial.net/)
- [SQLAlchemy ORM quickstart](https://docs.sqlalchemy.org/en/20/orm/quickstart.html)

---

## 7. MCP servers (Claude queries your database)

MCP (Model Context Protocol) lets Claude call your code as tools mid-conversation.

```
You: "Are there common Alu insertions near BRCA2 in Africans?"

Claude automatically calls:
  search_insertions(
    chrom="chr13", start=32315508, end=32400268,
    me_type="ALU", population="AFR", min_freq=0.10
  )

Returns real data from your DB. Claude answers with actual numbers.
```

The MCP server wraps the API. Claude talks to the API, not the DB directly.

**Read:** [MCP Python quickstart](https://modelcontextprotocol.io/quickstart/server)

---

## Reading list

| When | What | Time |
|------|------|------|
| First | [FastAPI first steps](https://fastapi.tiangolo.com/tutorial/first-steps/) | 30 min |
| First | [SQLite tutorial (first 5 pages)](https://www.sqlitetutorial.net/) | 45 min |
| Phase 1 | [SQLAlchemy ORM quickstart](https://docs.sqlalchemy.org/en/20/orm/quickstart.html) | 30 min |
| Phase 1 | [Pydantic v2 models](https://docs.pydantic.dev/latest/concepts/models/) | 20 min |
| Phase 2 | [FastAPI query params](https://fastapi.tiangolo.com/tutorial/query-params/) | 20 min |
| Phase 3 | [MCP Python quickstart](https://modelcontextprotocol.io/quickstart/server) | 20 min |
| Phase 4 | [UCSC coordinate systems](https://genome-blog.soe.ucsc.edu/blog/2016/12/12/the-ucsc-genome-browser-coordinate-counting-systems/) | 10 min |
| Background | [1000 Genomes overview](https://www.internationalgenome.org/about) | 15 min |
