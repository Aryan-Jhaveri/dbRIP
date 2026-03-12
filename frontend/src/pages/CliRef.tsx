/**
 * CliRef — Static CLI reference page for the `dbrip` command-line tool.
 *
 * WHAT THIS PAGE DOES:
 *   Documents how to install and use the `dbrip` CLI: all 5 subcommands,
 *   their flags, and usage examples.
 *
 * WHY STATIC?
 *   Docs don't change at runtime. A static component has no loading state,
 *   no error state, and nothing to break.
 *
 * HOW THIS FILE CONNECTS TO THE REST:
 *   - Imported and rendered by App.tsx when activeTab === "cli-ref"
 *   - No hooks, no state, no API calls
 */

// ── Sub-component ─────────────────────────────────────────────────────────

/**
 * CliCommand — documents a single CLI subcommand.
 *
 * @param name     The subcommand, e.g. "dbrip search"
 * @param desc     One-line description
 * @param flags    Array of [flag, description] pairs
 * @param example  Optional multi-line usage example
 */
function CliCommand({
  name,
  desc,
  flags,
  example,
}: {
  name: string;
  desc: string;
  flags: [string, string][];
  example?: string;
}) {
  return (
    <div className="mb-6">
      <code className="text-sm bg-gray-100 font-mono px-1 font-semibold">{name}</code>
      <p className="text-sm mt-1">{desc}</p>
      {flags.length > 0 && (
        <table className="text-sm border border-black w-full mt-2">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-black px-2 py-1 text-left font-semibold">Flag</th>
              <th className="border border-black px-2 py-1 text-left font-semibold">Description</th>
            </tr>
          </thead>
          <tbody>
            {flags.map(([flag, description]) => (
              <tr key={flag}>
                <td className="border border-black px-2 py-1 font-mono bg-gray-100 whitespace-nowrap">{flag}</td>
                <td className="border border-black px-2 py-1">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {example && (
        <pre className="text-sm bg-gray-100 font-mono px-2 py-1 mt-2 overflow-x-auto">{example}</pre>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function CliRef() {
  return (
    <div className="max-w-4xl">
      <p className="text-sm mb-4">
        The <code className="bg-gray-100 font-mono px-1">dbrip</code> CLI is a thin wrapper
        around the REST API. Every command sends an HTTP request to the running API server —
        it never accesses the database directly.
      </p>

      {/* Installation */}
      <div className="mb-6">
        <p className="text-sm font-semibold mb-1">Installation</p>
        <pre className="text-sm bg-gray-100 font-mono px-2 py-1 overflow-x-auto">
{`pip install -e .

# Point the CLI at your API server (defaults to http://localhost:8000):
export DBRIP_API_URL=http://localhost:8000`}
        </pre>
      </div>

      {/* dbrip search */}
      <CliCommand
        name="dbrip search"
        desc="Search insertions. Without --region, queries the entire database. With --region, restricts to a genomic window."
        flags={[
          ["--region, -r <chrom:start-end>", "Genomic region, e.g. chr1:1M-5M. Supports K/M suffixes."],
          ["--me-type <type>", "TE family: ALU, LINE1, SVA, HERVK, PP"],
          ["--me-subtype <subtype>", "TE subfamily, e.g. AluYa5"],
          ["--me-category <cat>", "Reference or Non-reference"],
          ["--variant-class <class>", "Frequency class: Common, Rare, etc."],
          ["--annotation <ann>", "Genomic context: INTRONIC, EXON, PROMOTER, etc."],
          ["--population, -p <pop>", "Population code, e.g. EUR, AFR"],
          ["--min-freq <float>", "Minimum allele frequency (requires --population)"],
          ["--max-freq <float>", "Maximum allele frequency (requires --population)"],
          ["--limit, -l <int>", "Number of results (default 50, max 1000)"],
          ["--offset <int>", "Pagination offset"],
          ["--output, -o <fmt>", "Output format: table (default) or json"],
        ]}
        example={`dbrip search --me-type ALU --limit 10
dbrip search --region chr1:1M-5M --me-type ALU
dbrip search --population EUR --min-freq 0.1 --output json`}
      />

      {/* dbrip get */}
      <CliCommand
        name="dbrip get <ID>"
        desc="Get full details for a single insertion by ID, including all population frequencies."
        flags={[
          ["--output, -o <fmt>", "Output format: table (default) or json"],
        ]}
        example={`dbrip get A0000001
dbrip get A0000001 --output json`}
      />

      {/* dbrip export */}
      <CliCommand
        name="dbrip export"
        desc="Download insertions as BED, VCF, or CSV. Writes to stdout by default (pipe-friendly), or to a file with --out."
        flags={[
          ["--format, -f <fmt>", "Export format: bed, vcf, or csv (default: bed)"],
          ["--out, -o <path>", "Output file path. Defaults to stdout."],
          ["--me-type <type>", "TE family filter"],
          ["--me-subtype <subtype>", "TE subfamily filter"],
          ["--me-category <cat>", "Reference or Non-reference"],
          ["--variant-class <class>", "Frequency class filter"],
          ["--annotation <ann>", "Genomic context filter"],
          ["--population, -p <pop>", "Population code filter"],
          ["--min-freq <float>", "Minimum allele frequency filter"],
          ["--max-freq <float>", "Maximum allele frequency filter"],
        ]}
        example={`dbrip export --format bed --me-type ALU -o alu.bed
dbrip export --format vcf --population EUR --min-freq 0.1
dbrip export --format bed | bedtools intersect -a - -b peaks.bed`}
      />

      {/* dbrip stats */}
      <CliCommand
        name="dbrip stats"
        desc="Show summary counts grouped by a field."
        flags={[
          ["--by, -b <field>", "Field to group by: me_type (default), chrom, variant_class, annotation, me_category, dataset_id"],
          ["--output, -o <fmt>", "Output format: table (default) or json"],
        ]}
        example={`dbrip stats
dbrip stats --by chrom
dbrip stats --by variant_class --output json`}
      />

      {/* dbrip datasets */}
      <CliCommand
        name="dbrip datasets"
        desc="List all loaded datasets with version, assembly, row count, and load date."
        flags={[
          ["--output, -o <fmt>", "Output format: table (default) or json"],
        ]}
        example={`dbrip datasets
dbrip datasets --output json`}
      />
    </div>
  );
}
