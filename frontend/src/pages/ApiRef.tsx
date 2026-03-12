/**
 * ApiRef — Static REST API reference page.
 *
 * WHAT THIS PAGE DOES:
 *   Documents all 8 read-only API endpoints: their HTTP method, path,
 *   purpose, and accepted query/path parameters.
 *
 * WHY STATIC?
 *   Docs don't change at runtime. A static component has no loading state,
 *   no error state, and nothing to break.
 *
 * HOW THIS FILE CONNECTS TO THE REST:
 *   - Imported and rendered by App.tsx when activeTab === "api-ref"
 *   - No hooks, no state, no API calls
 */

// ── Sub-components ────────────────────────────────────────────────────────

/**
 * Endpoint — documents a single API endpoint.
 *
 * @param method   HTTP verb (GET, POST)
 * @param path     URL path, e.g. /v1/insertions
 * @param desc     One-line description of what it does
 * @param children Optional params table
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
    <div className="mb-6">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold border border-black px-1">{method}</span>
        <code className="text-sm bg-gray-100 font-mono px-1">{path}</code>
      </div>
      <p className="text-sm mt-1">{desc}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

/**
 * ParamsTable — renders a table of parameter documentation.
 *
 * @param rows  Array of [name, type, description] tuples
 */
function ParamsTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <table className="text-sm border border-black w-full">
      <thead>
        <tr className="bg-gray-100">
          <th className="border border-black px-2 py-1 text-left font-semibold">Parameter</th>
          <th className="border border-black px-2 py-1 text-left font-semibold">Type</th>
          <th className="border border-black px-2 py-1 text-left font-semibold">Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, type, description]) => (
          <tr key={name}>
            <td className="border border-black px-2 py-1 font-mono bg-gray-100">{name}</td>
            <td className="border border-black px-2 py-1 text-gray-600">{type}</td>
            <td className="border border-black px-2 py-1">{description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function ApiRef() {
  return (
    <div className="max-w-4xl">
      <p className="text-sm mb-6">
        All endpoints are read-only. Base URL:{" "}
        <code className="bg-gray-100 font-mono px-1">http://localhost:8000</code> (or wherever
        the API is deployed).
      </p>

      {/* GET /v1/insertions */}
      <Endpoint
        method="GET"
        path="/v1/insertions"
        desc="List insertions with optional filters. Returns a paginated response with total count."
      >
        <ParamsTable
          rows={[
            ["me_type", "string", "TE family: ALU, LINE1, SVA, HERVK, PP"],
            ["me_subtype", "string", "TE subfamily, e.g. AluYa5"],
            ["me_category", "string", "Reference or Non-reference"],
            ["variant_class", "string", "Frequency class: Common, Rare, etc."],
            ["annotation", "string", "Genomic context: PROMOTER, INTRONIC, EXON, 5_UTR, 3_UTR, TERMINATOR, INTERGENIC"],
            ["population", "string", "1000 Genomes population code, e.g. EUR, AFR"],
            ["min_freq", "float", "Minimum allele frequency (0.0–1.0). Requires population."],
            ["max_freq", "float", "Maximum allele frequency (0.0–1.0). Requires population."],
            ["strand", "string", "Strand: + or - (comma-separated for multiple)"],
            ["chrom", "string", "Chromosome, e.g. chr1 (comma-separated for multiple)"],
            ["search", "string", "Free-text search across ID and subtype fields"],
            ["limit", "integer", "Number of results to return (default 50, max 1000)"],
            ["offset", "integer", "Pagination offset (default 0)"],
          ]}
        />
      </Endpoint>

      {/* POST /v1/insertions/file-search */}
      <Endpoint
        method="POST"
        path="/v1/insertions/file-search"
        desc="Upload a BED or VCF file and find insertions overlapping those regions. Returns a paginated response."
      >
        <ParamsTable
          rows={[
            ["file", "file (multipart)", "BED or VCF file containing target regions"],
            ["window", "integer", "Extend each region by ±N bp before matching (default 0)"],
            ["limit", "integer", "Number of results to return (default 50, max 1000)"],
            ["offset", "integer", "Pagination offset (default 0)"],
          ]}
        />
      </Endpoint>

      {/* GET /v1/insertions/{id} */}
      <Endpoint
        method="GET"
        path="/v1/insertions/{id}"
        desc="Get full details for a single insertion by ID, including all population frequencies."
      >
        <ParamsTable
          rows={[
            ["id", "path param", "Insertion ID, e.g. A0000001"],
          ]}
        />
      </Endpoint>

      {/* GET /v1/insertions/region/{assembly}/{chrom}:{start}-{end} */}
      <Endpoint
        method="GET"
        path="/v1/insertions/region/{assembly}/{chrom}:{start}-{end}"
        desc="List insertions within a genomic region. Accepts all the same filter params as GET /v1/insertions."
      >
        <ParamsTable
          rows={[
            ["assembly", "path param", "Genome assembly, e.g. hg38"],
            ["chrom", "path param", "Chromosome, e.g. chr1"],
            ["start", "path param", "Region start position (0-based)"],
            ["end", "path param", "Region end position"],
            ["…filters", "query", "Same filter params as GET /v1/insertions (me_type, population, etc.)"],
            ["limit", "integer", "Number of results (default 50, max 1000)"],
            ["offset", "integer", "Pagination offset (default 0)"],
          ]}
        />
      </Endpoint>

      {/* GET /v1/export */}
      <Endpoint
        method="GET"
        path="/v1/export"
        desc="Download insertions as BED, VCF, or CSV. Accepts all the same filter params as GET /v1/insertions. Returns the file as a download."
      >
        <ParamsTable
          rows={[
            ["format", "string", "Export format: bed, vcf, or csv"],
            ["…filters", "query", "Same filter params as GET /v1/insertions"],
          ]}
        />
      </Endpoint>

      {/* GET /v1/stats */}
      <Endpoint
        method="GET"
        path="/v1/stats"
        desc="Return summary counts grouped by a field. Useful for building charts or quick summaries."
      >
        <ParamsTable
          rows={[
            ["by", "string", "Field to group by: me_type, chrom, variant_class, annotation, me_category, dataset_id"],
          ]}
        />
      </Endpoint>

      {/* GET /v1/datasets */}
      <Endpoint
        method="GET"
        path="/v1/datasets"
        desc="List all loaded datasets with metadata (version, assembly, row count, load date)."
      />

      {/* GET /v1/health */}
      <Endpoint
        method="GET"
        path="/v1/health"
        desc='Health check. Returns {"status": "ok"} when the API is running.'
      />
    </div>
  );
}
