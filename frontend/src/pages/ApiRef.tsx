/**
 * ApiRef — Static REST API reference page.
 *
 * WHAT THIS PAGE DOES:
 *   Documents all 9 read-only API endpoints: their HTTP method, path,
 *   accepted parameters, and worked curl examples with sample JSON responses.
 *
 * WHY STATIC?
 *   Docs don't change at runtime. A static component has no loading state,
 *   no error state, and nothing to break.
 *
 * URL NOTE:
 *   curl examples use http://localhost:8000. When deployed, replace this with
 *   the actual server URL. The frontend itself sends relative /v1/* paths, so
 *   it adapts automatically to any origin — only the curl examples need updating.
 *
 * HOW THIS FILE CONNECTS TO THE REST:
 *   - Imported and rendered by App.tsx when activeTab === "api-ref"
 *   - No hooks, no state, no API calls
 */

// ── Sub-components ────────────────────────────────────────────────────────

/**
 * Endpoint — documents a single API endpoint.
 *
 * @param method   HTTP verb ("GET", "POST")
 * @param path     URL path, e.g. /v1/insertions
 * @param desc     One-line description of what it does
 * @param children Optional params table and/or example blocks
 */
function Endpoint({
  method,
  path,
  desc,
  children,
}: {
  method: string;
  path: string;
  desc: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold border border-black dark:border-gray-500 px-1">{method}</span>
        <code className="text-sm bg-gray-100 dark:bg-gray-800 font-mono px-1">{path}</code>
      </div>
      <p className="text-sm mt-1">{desc}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

/**
 * ParamsTable — renders a table of parameter documentation.
 *
 * @param rows  Array of [name, type, description] tuples.
 *              The "name" is shown in a monospace column; "type" is the
 *              data type or location (path param, float, etc.); "description"
 *              explains the field and any valid values.
 */
function ParamsTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <table className="text-sm border border-black dark:border-gray-500 w-full">
      <thead>
        <tr className="bg-gray-100 dark:bg-gray-800">
          <th className="border border-black dark:border-gray-500 px-2 py-1 text-left font-semibold">Parameter</th>
          <th className="border border-black dark:border-gray-500 px-2 py-1 text-left font-semibold">Type</th>
          <th className="border border-black dark:border-gray-500 px-2 py-1 text-left font-semibold">Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, type, description]) => (
          <tr key={name}>
            <td className="border border-black dark:border-gray-500 px-2 py-1 font-mono bg-gray-100 dark:bg-gray-800">{name}</td>
            <td className="border border-black dark:border-gray-500 px-2 py-1 text-gray-600 dark:text-gray-400">{type}</td>
            <td className="border border-black dark:border-gray-500 px-2 py-1">{description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Example — renders a worked curl command and/or sample JSON response.
 *
 * Shown below the params table for each endpoint so you can copy-paste a
 * working request immediately. Comments inside the block (lines starting
 * with #) explain what each request does.
 *
 * @param code  The multi-line string to display verbatim in a code block.
 */
function Example({ code }: { code: string }) {
  return (
    <pre className="text-sm bg-gray-100 dark:bg-gray-800 font-mono px-2 py-2 mt-2 overflow-x-auto whitespace-pre">
      {code}
    </pre>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function ApiRef() {
  return (
    <div className="max-w-4xl">
      {/* Intro / base URL note */}
      <p className="text-sm mb-2">
        All endpoints are read-only — no writes to the database. curl examples
        below use{" "}
        <code className="bg-gray-100 dark:bg-gray-800 font-mono px-1">http://localhost:8000</code>
        . Replace this with your server's address when deployed.
      </p>
      <p className="text-sm mb-6">
        The frontend sends relative{" "}
        <code className="bg-gray-100 dark:bg-gray-800 font-mono px-1">/v1/*</code> paths; the
        Vite dev proxy forwards these to the API at port 8000. In production
        both are served from the same origin so no proxy is needed.
      </p>

      {/* ── GET /v1/insertions ──────────────────────────────────────────── */}
      <Endpoint
        method="GET"
        path="/v1/insertions"
        desc="List insertions with optional filters and pagination. All filter params use AND logic — providing multiple filters narrows the result set. Several params accept comma-separated values for OR logic within a single field."
      >
        <ParamsTable
          rows={[
            [
              "me_type",
              "string",
              "TE family: ALU, LINE1, SVA, HERVK. Comma-separate for OR logic: me_type=ALU,SVA",
            ],
            ["me_subtype", "string", "TE subfamily, e.g. AluYa5, AluYb8 (exact match)"],
            [
              "me_category",
              "string",
              "Non-reference or Reference. Comma-separate for multiple.",
            ],
            [
              "variant_class",
              "string",
              "Common, Intermediate, Rare, or Very Rare. Comma-separate for multiple.",
            ],
            [
              "annotation",
              "string",
              "Genomic context: INTRONIC, INTERGENIC, EXON, PROMOTER, 5_UTR, 3_UTR, TERMINATOR. Comma-separate for multiple.",
            ],
            ["dataset_id", "string", "Filter by dataset source, e.g. dbrip_v1"],
            [
              "population",
              "string",
              "1000 Genomes population code: EUR, AFR, EAS, SAS, AMR, ACB, ASW, BEB, CDX, CEU, CHB, CHS, CLM, ESN, FIN, GBR, GIH, GWD, IBS, ITU, JPT, KHV, LWK, MSL, MXL, PEL, PJL, PUR, STU, TSI, YRI, Non_African, All",
            ],
            [
              "min_freq",
              "float",
              "Minimum allele frequency (0.0–1.0). Requires population.",
            ],
            [
              "max_freq",
              "float",
              "Maximum allele frequency (0.0–1.0). Requires population.",
            ],
            [
              "strand",
              "string",
              'Strand: + or - (URL-encode + as %2B). Comma-separate for multiple: strand=%2B,-. Use "null" to match rows with no strand value.',
            ],
            [
              "chrom",
              "string",
              "Chromosome, e.g. chr1. Comma-separate for multiple: chrom=chr1,chrX,chrY",
            ],
            [
              "search",
              "string",
              "Free-text search across id, chrom, me_type, me_category, rip_type, me_subtype, annotation, variant_class (server-side LIKE, case-insensitive). Used by the search box in Interactive Search.",
            ],
            ["limit", "integer", "Page size (default 50, max 1000)"],
            ["offset", "integer", "Pagination offset (default 0)"],
          ]}
        />
        <Example
          code={`# Common ALU insertions on chr1, first 3 results
curl "http://localhost:8000/v1/insertions?me_type=ALU&variant_class=Common&chrom=chr1&limit=3"

# Response
{
  "total": 1842,
  "limit": 3,
  "offset": 0,
  "results": [
    {
      "id": "A0000042",
      "dataset_id": "dbrip_v1",
      "assembly": "hg38",
      "chrom": "chr1",
      "start": 1234567,
      "end": 1234568,
      "strand": "+",
      "me_category": "Non-reference",
      "me_type": "ALU",
      "rip_type": "Non-reference",
      "me_subtype": "AluYa5",
      "me_length": 281,
      "tsd": "AAAAGAAATGAAT",
      "annotation": "INTRONIC",
      "variant_class": "Common"
    }
  ]
}

# ALU or SVA insertions with allele freq ≥ 5% in Europeans
curl "http://localhost:8000/v1/insertions?me_type=ALU,SVA&population=EUR&min_freq=0.05"

# Page 2 of the above (offset by limit)
curl "http://localhost:8000/v1/insertions?me_type=ALU,SVA&population=EUR&min_freq=0.05&limit=50&offset=50"`}
        />
      </Endpoint>

      {/* ── POST /v1/insertions/file-search ────────────────────────────── */}
      <Endpoint
        method="POST"
        path="/v1/insertions/file-search"
        desc="Upload a BED, CSV, or TSV file and find all insertions that overlap those genomic regions. Returns the same paginated response as GET /v1/insertions."
      >
        <ParamsTable
          rows={[
            [
              "file",
              "file (multipart)",
              "BED file (tab-separated, no header, columns: chrom start end) or CSV/TSV with chrom/start/end header columns. BED coordinates are 0-based.",
            ],
            [
              "window",
              "integer",
              "Extend each region by ±N bp before matching (default 0). E.g. window=500 finds insertions within 500 bp of a region boundary.",
            ],
            ["limit", "integer", "Page size (default 50, max 1000)"],
            ["offset", "integer", "Pagination offset (default 0)"],
          ]}
        />
        <Example
          code={`# Upload a BED file, extend regions by 500 bp
curl -X POST "http://localhost:8000/v1/insertions/file-search?window=500" \\
     -F "file=@regions.bed"

# Upload a CSV file with chrom/start/end columns
curl -X POST "http://localhost:8000/v1/insertions/file-search" \\
     -F "file=@genes.csv"

# Response shape is identical to GET /v1/insertions
{
  "total": 17,
  "limit": 50,
  "offset": 0,
  "results": [ ... ]
}`}
        />
      </Endpoint>

      {/* ── GET /v1/insertions/{id} ─────────────────────────────────────── */}
      <Endpoint
        method="GET"
        path="/v1/insertions/{id}"
        desc="Get full details for a single insertion by ID, including all 33 population frequencies. Returns 404 if the ID does not exist."
      >
        <ParamsTable
          rows={[["id", "path param", "Insertion ID, e.g. A0000001"]]}
        />
        <Example
          code={`curl http://localhost:8000/v1/insertions/A0000001

# Response
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
  "tsd": "AAAAAATGGTAAT",
  "annotation": "INTRONIC",
  "variant_class": "Very Rare",
  "populations": [
    { "population": "All",         "af": 0.0002 },
    { "population": "EUR",         "af": 0.0    },
    { "population": "AFR",         "af": 0.0028 },
    { "population": "EAS",         "af": 0.0    },
    { "population": "SAS",         "af": 0.0    },
    { "population": "AMR",         "af": 0.0    }
  ]
}`}
        />
      </Endpoint>

      {/* ── GET /v1/insertions/region/{assembly}/{chrom}:{start}-{end} ──── */}
      <Endpoint
        method="GET"
        path="/v1/insertions/region/{assembly}/{chrom}:{start}-{end}"
        desc="List insertions within a genomic region. Accepts all the same filter params as GET /v1/insertions (except chrom, which is encoded in the path). Returns 400 if the region format is invalid."
      >
        <ParamsTable
          rows={[
            ["assembly", "path param", "Genome assembly, e.g. hg38"],
            ["chrom", "path param", "Chromosome, e.g. chr1, chrX"],
            ["start", "path param", "Region start position (1-based)"],
            ["end", "path param", "Region end position (1-based)"],
            [
              "…filters",
              "query",
              "Same filter params as GET /v1/insertions: me_type, me_category, variant_class, population, min_freq, strand, search, limit, offset, etc.",
            ],
          ]}
        />
        <Example
          code={`# All insertions on chr1 between 1 Mb and 5 Mb
curl "http://localhost:8000/v1/insertions/region/hg38/chr1:1000000-5000000"

# Only ALU insertions in that region
curl "http://localhost:8000/v1/insertions/region/hg38/chr1:1000000-5000000?me_type=ALU"

# Common ALU insertions in Europeans (allele freq ≥ 5%)
curl "http://localhost:8000/v1/insertions/region/hg38/chr1:1000000-5000000?me_type=ALU&population=EUR&min_freq=0.05"

# Response shape is the same as GET /v1/insertions
{
  "total": 23,
  "limit": 50,
  "offset": 0,
  "results": [ ... ]
}`}
        />
      </Endpoint>

      {/* ── GET /v1/export ──────────────────────────────────────────────── */}
      <Endpoint
        method="GET"
        path="/v1/export"
        desc="Download insertions as BED6, VCF 4.2, or CSV. Accepts all the same filter params as GET /v1/insertions. Returns the file as a streaming download (Content-Disposition: attachment)."
      >
        <ParamsTable
          rows={[
            [
              "format",
              "string",
              "Export format: bed (default), vcf, or csv",
            ],
            [
              "…filters",
              "query",
              "Same filter params as GET /v1/insertions: me_type, me_category, variant_class, population, min_freq, strand, chrom, dataset_id, etc.",
            ],
          ]}
        />
        <Example
          code={`# Export all ALU insertions as BED6 (0-based coordinates)
curl "http://localhost:8000/v1/export?format=bed&me_type=ALU" -o alu.bed

# BED output (tab-separated: chrom start end name score strand)
chr1    758507  758509  A0000001  0  +
chr1    930145  930146  A0000002  0  -

# Export common LINE1 as VCF 4.2 (1-based coordinates, no conversion needed)
curl "http://localhost:8000/v1/export?format=vcf&me_type=LINE1&variant_class=Common" -o l1.vcf

# Export everything as CSV (includes one column per population frequency)
curl "http://localhost:8000/v1/export?format=csv" -o all.csv

# Note: BED start = DB start − 1 (0-based conversion). VCF and CSV use 1-based.`}
        />
      </Endpoint>

      {/* ── GET /v1/stats ───────────────────────────────────────────────── */}
      <Endpoint
        method="GET"
        path="/v1/stats"
        desc="Return summary counts grouped by a field. Uses SQL GROUP BY — fast even on the full 44,984-row dataset. Returns 400 if the by field is not in the allowed list."
      >
        <ParamsTable
          rows={[
            [
              "by",
              "string",
              "Field to group by (default: me_type). Allowed: me_type, me_subtype, me_category, chrom, variant_class, annotation, dataset_id",
            ],
          ]}
        />
        <Example
          code={`curl "http://localhost:8000/v1/stats?by=me_type"

# Response
{
  "group_by": "me_type",
  "entries": [
    { "label": "ALU",   "count": 33709 },
    { "label": "LINE1", "count": 6468  },
    { "label": "SVA",   "count": 4697  },
    { "label": "HERVK", "count": 101   }
  ]
}

# Counts by variant class
curl "http://localhost:8000/v1/stats?by=variant_class"

# Counts by chromosome
curl "http://localhost:8000/v1/stats?by=chrom"`}
        />
      </Endpoint>

      {/* ── GET /v1/datasets ────────────────────────────────────────────── */}
      <Endpoint
        method="GET"
        path="/v1/datasets"
        desc="List all loaded datasets with metadata: version, assembly, row count, and load date."
      >
        <Example
          code={`curl http://localhost:8000/v1/datasets

# Response
[
  {
    "id": "dbrip_v1",
    "version": "1.0",
    "label": "dbRIP — Database of Retrotransposon Insertion Polymorphisms",
    "source_url": "https://lianglab.shinyapps.io/shinydbRIP/",
    "assembly": "hg38",
    "row_count": 44984,
    "loaded_at": "2024-03-11T12:00:00"
  }
]`}
        />
      </Endpoint>

      {/* ── GET /v1/datasets/{id} ───────────────────────────────────────── */}
      <Endpoint
        method="GET"
        path="/v1/datasets/{id}"
        desc="Get metadata for a single dataset. Returns 404 if the dataset ID does not exist."
      >
        <ParamsTable
          rows={[["id", "path param", "Dataset ID, e.g. dbrip_v1"]]}
        />
        <Example
          code={`curl http://localhost:8000/v1/datasets/dbrip_v1

# Returns the same object shape as a single item in GET /v1/datasets`}
        />
      </Endpoint>

      {/* ── GET /v1/health ──────────────────────────────────────────────── */}
      <Endpoint
        method="GET"
        path="/v1/health"
        desc='Health check. Returns {"status": "ok"} when the API is running. Useful for Docker health checks and uptime monitors.'
      >
        <Example
          code={`curl http://localhost:8000/v1/health

# Response
{ "status": "ok" }`}
        />
      </Endpoint>

      {/* ── Error Responses ─────────────────────────────────────────────── */}
      {/*
       * Every endpoint returns errors in the same JSON shape so callers
       * can handle them uniformly. The "detail" field contains a human-
       * readable message explaining what went wrong.
       */}
      <div className="mb-6">
        <p className="text-sm font-semibold mb-2">Error Responses</p>
        <p className="text-sm mb-2">
          All errors return JSON with a{" "}
          <code className="bg-gray-100 dark:bg-gray-800 font-mono px-1">detail</code> field:
        </p>
        <pre className="text-sm bg-gray-100 dark:bg-gray-800 font-mono px-2 py-2 mb-2 overflow-x-auto">
          {'{"detail": "Insertion FAKE123 not found"}'}
        </pre>
        <table className="text-sm border border-black dark:border-gray-500 w-full">
          <thead>
            <tr className="bg-gray-100 dark:bg-gray-800">
              <th className="border border-black dark:border-gray-500 px-2 py-1 text-left font-semibold">
                Status
              </th>
              <th className="border border-black dark:border-gray-500 px-2 py-1 text-left font-semibold">
                Meaning
              </th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["400", "Bad request — invalid region format, export format, group_by field, or empty file"],
                ["404", "Resource not found — insertion ID or dataset ID does not exist"],
                ["500", "Server error — check API server logs"],
              ] as [string, string][]
            ).map(([status, meaning]) => (
              <tr key={status}>
                <td className="border border-black dark:border-gray-500 px-2 py-1 font-mono bg-gray-100 dark:bg-gray-800">
                  {status}
                </td>
                <td className="border border-black dark:border-gray-500 px-2 py-1">{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
