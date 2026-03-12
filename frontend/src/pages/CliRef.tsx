/**
 * CliRef — Static CLI reference page for the `dbrip` command-line tool.
 *
 * WHAT THIS PAGE DOES:
 *   Documents how to install and use the `dbrip` CLI: all 5 subcommands,
 *   their flags, worked examples, region shorthand syntax, and piping recipes.
 *
 * WHY STATIC?
 *   Docs don't change at runtime. A static component has no loading state,
 *   no error state, and nothing to break.
 *
 * HOW THIS FILE CONNECTS TO THE REST:
 *   - Imported and rendered by App.tsx when activeTab === "cli-ref"
 *   - Uses local useState in CliCommand for collapsible open/closed state;
 *     no API calls are made
 */

import { useState } from "react";

// ── Sub-component ─────────────────────────────────────────────────────────

/**
 * CliCommand — documents a single CLI subcommand as a collapsible section.
 *
 * Clicking the header row (command name + description) toggles the flags
 * table and example block open and closed. Collapsed by default so the
 * page starts as a compact list of commands — expand only what you need.
 *
 * @param name     The subcommand as typed, e.g. "dbrip search"
 * @param desc     One-line description of what it does
 * @param flags    Array of [flag-syntax, description] pairs. Flag syntax
 *                 should match what `dbrip <cmd> --help` shows exactly.
 * @param example  Optional multi-line usage example shown in a code block.
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
  // Collapsed by default — page starts as a compact list of commands.
  const [open, setOpen] = useState(false);
  const hasDetails = flags.length > 0 || example !== undefined;

  return (
    <div className="mb-3 border border-black dark:border-gray-500">
      {/*
       * Clickable header — clicking anywhere in this row toggles open/closed.
       * Using a <button> for keyboard + screen-reader accessibility.
       */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 flex items-start gap-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
        aria-expanded={open}
      >
        <div className="flex-1 min-w-0">
          <code className="text-sm bg-gray-100 dark:bg-gray-800 font-mono px-1 font-semibold">{name}</code>
          <p className="text-sm mt-1">{desc}</p>
        </div>
        {/* Chevron — points right when collapsed, down when expanded */}
        <span className="text-xs shrink-0 mt-1 select-none">{open ? "▾" : "▸"}</span>
      </button>

      {/* Collapsible details — flags table + usage example */}
      {open && hasDetails && (
        <div className="px-3 pt-2 pb-3 border-t border-black dark:border-gray-500">
          {flags.length > 0 && (
            <table className="text-sm border border-black dark:border-gray-500 w-full mt-2">
              <thead>
                <tr className="bg-gray-100 dark:bg-gray-800">
                  <th className="border border-black dark:border-gray-500 px-2 py-1 text-left font-semibold">Flag</th>
                  <th className="border border-black dark:border-gray-500 px-2 py-1 text-left font-semibold">Description</th>
                </tr>
              </thead>
              <tbody>
                {flags.map(([flag, description]) => (
                  <tr key={flag}>
                    <td className="border border-black dark:border-gray-500 px-2 py-1 font-mono bg-gray-100 dark:bg-gray-800 whitespace-nowrap">
                      {flag}
                    </td>
                    <td className="border border-black dark:border-gray-500 px-2 py-1">{description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {example && (
            <pre className="text-sm bg-gray-100 dark:bg-gray-800 font-mono px-2 py-1 mt-2 overflow-x-auto">
              {example}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function CliRef() {
  return (
    <div className="max-w-4xl">
      {/* Intro paragraph */}
      <p className="text-sm mb-4">
        The <code className="bg-gray-100 dark:bg-gray-800 font-mono px-1">dbrip</code> CLI is a
        thin wrapper around the REST API. Every command sends an HTTP request to
        the running API server — it never accesses the database directly.
      </p>

      {/* Installation */}
      <div className="mb-6">
        <p className="text-sm font-semibold mb-1">Installation</p>
        <pre className="text-sm bg-gray-100 dark:bg-gray-800 font-mono px-2 py-1 overflow-x-auto">
{`pip install "dbrip-api[cli] @ git+https://github.com/Aryan-Jhaveri/dbRIP.git"

# Point the CLI at the hosted server (add to ~/.bashrc or ~/.zshrc):
export DBRIP_API_URL=https://<your-deploy-url>`}
        </pre>
      </div>

      {/* dbrip search */}
      <CliCommand
        name="dbrip search"
        desc="Search insertions with optional filters. Without --region, queries the entire database. With --region, restricts to a genomic window using the region endpoint."
        flags={[
          ["--region, -r <chrom:start-end>", "Genomic region, e.g. chr1:1M-5M. Supports K/M suffixes (see Region Shorthand below)."],
          ["--assembly, -a <assembly>", "Genome assembly used with --region (default: hg38)."],
          ["--me-type <type>", "TE family: ALU, LINE1, SVA, HERVK. Comma-separate for multiple: ALU,SVA"],
          ["--me-subtype <subtype>", "TE subfamily, e.g. AluYa5"],
          ["--me-category <cat>", "Reference or Non-reference"],
          ["--variant-class <class>", "Common, Intermediate, Rare, or Very Rare"],
          ["--annotation <ann>", "Genomic context: INTRONIC, EXON, PROMOTER, 5_UTR, 3_UTR, INTERGENIC, TERMINATOR"],
          ["--dataset-id <id>", "Filter by dataset source, e.g. dbrip_v1"],
          ["--population, -p <pop>", "Population code, e.g. EUR, AFR, EAS, SAS, AMR"],
          ["--min-freq <float>", "Minimum allele frequency (requires --population)"],
          ["--max-freq <float>", "Maximum allele frequency (requires --population)"],
          ["--limit, -l <int>", "Number of results (default 50, max 1000)"],
          ["--offset <int>", "Pagination offset"],
          ["--output, -o <fmt>", "Output format: table (default) or json"],
        ]}
        example={`# ALU insertions, first 10 results
dbrip search --me-type ALU --limit 10

# Region query with K/M shorthand
dbrip search --region chr1:1M-5M --me-type ALU

# Common insertions in Europeans, allele freq ≥ 10%
dbrip search --population EUR --min-freq 0.1 --variant-class Common

# Machine-readable JSON output
dbrip search --me-type ALU --output json

# Multiple TE types (comma-separated, no spaces)
dbrip search --me-type ALU,SVA --limit 20`}
      />

      {/* Region Shorthand */}
      {/*
       * This section explains the K/M suffix expansion that the CLI does
       * automatically before sending the request to the API. The API itself
       * only accepts plain integers — the CLI converts them.
       */}
      <div className="mb-8">
        <p className="text-sm font-semibold mb-1">Region Shorthand</p>
        <p className="text-sm mb-2">
          Use <code className="bg-gray-100 dark:bg-gray-800 font-mono px-1">K</code> (thousands) and{" "}
          <code className="bg-gray-100 dark:bg-gray-800 font-mono px-1">M</code> (millions) as suffixes
          in region coordinates. The CLI expands them to plain integers before
          sending the request.
        </p>
        <table className="text-sm border border-black dark:border-gray-500 w-full">
          <thead>
            <tr className="bg-gray-100 dark:bg-gray-800">
              <th className="border border-black dark:border-gray-500 px-2 py-1 text-left font-semibold">Input</th>
              <th className="border border-black dark:border-gray-500 px-2 py-1 text-left font-semibold">Expands to</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["chr1:1M-5M",    "chr1:1000000-5000000"],
                ["chr7:500K-1M",  "chr7:500000-1000000"],
                ["chr1:1.5M-2M",  "chr1:1500000-2000000"],
                ["chr1:100-200",  "chr1:100-200 (no change — plain integers pass through)"],
              ] as [string, string][]
            ).map(([input, expanded]) => (
              <tr key={input}>
                <td className="border border-black dark:border-gray-500 px-2 py-1 font-mono bg-gray-100 dark:bg-gray-800">{input}</td>
                <td className="border border-black dark:border-gray-500 px-2 py-1 font-mono">{expanded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* dbrip get */}
      <CliCommand
        name="dbrip get <ID>"
        desc="Get full details for a single insertion by ID, including all 33 population frequencies displayed as a table."
        flags={[
          ["--output, -o <fmt>", "Output format: table (default) or json"],
        ]}
        example={`dbrip get A0000001
dbrip get A0000001 --output json`}
      />

      {/* dbrip export */}
      <CliCommand
        name="dbrip export"
        desc="Download insertions as BED6, VCF 4.2, or CSV. Writes to stdout by default (pipe-friendly) or to a file with --out. BED coordinates are 0-based; VCF and CSV are 1-based."
        flags={[
          ["--format, -f <fmt>", "Export format: bed (default), vcf, or csv"],
          ["--out, -o <path>", "Output file path. Omit to write to stdout."],
          ["--me-type <type>", "TE family filter (comma-separate for multiple)"],
          ["--me-subtype <subtype>", "TE subfamily filter"],
          ["--me-category <cat>", "Reference or Non-reference"],
          ["--variant-class <class>", "Frequency class filter"],
          ["--annotation <ann>", "Genomic context filter"],
          ["--dataset-id <id>", "Filter by dataset source, e.g. dbrip_v1"],
          ["--population, -p <pop>", "Population code filter"],
          ["--min-freq <float>", "Minimum allele frequency filter"],
          ["--max-freq <float>", "Maximum allele frequency filter"],
        ]}
        example={`# Export ALU insertions as BED to a file
dbrip export --format bed --me-type ALU -o alu.bed

# Export common LINE1 as VCF
dbrip export --format vcf --me-type LINE1 --variant-class Common

# Export with population frequency filter
dbrip export --format vcf --population EUR --min-freq 0.1

# Pipe directly into bedtools
dbrip export --format bed --me-type ALU | bedtools intersect -a - -b peaks.bed

# Export everything as CSV (includes all 33 pop freq columns)
dbrip export --format csv -o all_insertions.csv`}
      />

      {/* dbrip stats */}
      <CliCommand
        name="dbrip stats"
        desc="Show summary counts grouped by a field. The database does the counting (SQL GROUP BY), so this is fast even on the full dataset."
        flags={[
          ["--by, -b <field>", "Field to group by (default: me_type). Allowed: me_type, me_subtype, me_category, chrom, variant_class, annotation, dataset_id"],
          ["--output, -o <fmt>", "Output format: table (default) or json"],
        ]}
        example={`# Default: count by ME type
dbrip stats

# Count by chromosome
dbrip stats --by chrom

# Count by variant class, machine-readable
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

      {/* Piping & Scripting */}
      {/*
       * The CLI is designed to be used in shell pipelines. When stdout is
       * piped (not a terminal), rich table formatting is automatically
       * stripped so the output is clean text for awk/grep/bedtools.
       */}
      <div className="mb-6">
        <p className="text-sm font-semibold mb-2">Piping & Scripting</p>
        <p className="text-sm mb-2">
          When stdout is piped (not a terminal), rich table formatting is
          automatically disabled so output stays clean for downstream tools.
        </p>
        <pre className="text-sm bg-gray-100 dark:bg-gray-800 font-mono px-2 py-2 overflow-x-auto">
{`# Count ALU insertions per chromosome
dbrip export --format bed --me-type ALU | cut -f1 | sort | uniq -c | sort -rn

# Intersect with a BED file of ChIP-seq peaks
dbrip export --format bed | bedtools intersect -a - -b peaks.bed

# Extract all insertion IDs matching a filter
dbrip search --me-type SVA --output json | jq -r '.results[].id'

# Batch lookup of specific IDs
for id in A0000001 A0000002 A0000003; do
    dbrip get "$id" --output json >> results.jsonl
done

# Find LINE1 insertions near genes, then annotate
dbrip export --format bed --me-type LINE1 | \\
    bedtools closest -a - -b genes.bed -d | \\
    awk '$NF < 1000'   # insertions within 1 kb of a gene`}
        </pre>
      </div>
    </div>
  );
}
