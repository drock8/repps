"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  assertSafeDomain,
  invariantRunsJsonlPath,
  sessionDir,
} = require("./paths.js");
const {
  suggestInvariantsForFinding,
} = require("./invariant-template-corpus.js");
const { hashCanonicalJson } = require("./verification.js");

const TEST_FUNCTION_PREFIX = "testBobInvariant_";
const TEST_CONTRACT_PREFIX = "BobInvariantTest_";

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function ensureSessionDir(domain) {
  const dir = sessionDir(domain);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonlRuns(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const records = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      records.push(JSON.parse(lines[i]));
    } catch (err) {
      throw new Error(`Malformed invariant-runs.jsonl at line ${i + 1}: ${err.message || String(err)}`);
    }
  }
  return records;
}

function writeJsonlRuns(filePath, runs) {
  const sorted = runs.slice().sort((a, b) => {
    const aHash = typeof a.run_hash === "string" ? a.run_hash : "";
    const bHash = typeof b.run_hash === "string" ? b.run_hash : "";
    return aHash.localeCompare(bHash);
  });
  const body = sorted.map((run) => JSON.stringify(run)).join("\n");
  fs.writeFileSync(filePath, body.length > 0 ? body + "\n" : "", "utf8");
}

function deriveTestNamesFromTemplate(template, finding) {
  const sliceForName = (input) => {
    const cleaned = String(input || "").replace(/[^A-Za-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    return cleaned.slice(0, 32) || "Generic";
  };
  const idHash = crypto.createHash("sha256").update(`${template.template_id}:${finding.finding_hash || finding.title || ""}`).digest("hex").slice(0, 8);
  const baseName = sliceForName(template.template_id);
  return {
    contract_name: `${TEST_CONTRACT_PREFIX}${baseName}_${idHash}`,
    function_name: `${TEST_FUNCTION_PREFIX}${baseName}_${idHash}`,
  };
}

function renameTestFunction(testBody, functionName) {
  return testBody.replace(/function\s+\w+\s*\(/, `function ${functionName}(`);
}

function buildTestSource({ contractName, functionBody }) {
  const lines = [
    "// SPDX-License-Identifier: UNLICENSED",
    "pragma solidity >=0.8.0;",
    "",
    "import \"forge-std/Test.sol\";",
    "",
    `contract ${contractName} is Test {`,
    "    address public target;",
    "",
    "    function setUp() public virtual {",
    "        // The runner expects the harness to override setUp via inheritance",
    "        // when the template references concrete contracts.",
    "    }",
    "",
    indentLines(functionBody, 4),
    "}",
    "",
  ];
  return lines.join("\n");
}

function indentLines(text, spaces) {
  const padding = " ".repeat(spaces);
  return String(text)
    .split(/\r?\n/)
    .map((line) => (line.length === 0 ? line : `${padding}${line}`))
    .join("\n");
}

function ensureHarnessTestDir(harnessPath) {
  const testDir = path.join(harnessPath, "test");
  if (!fs.existsSync(testDir)) {
    throw new Error(`Foundry harness has no test/ directory: ${testDir}`);
  }
  const bobDir = path.join(testDir, "bob-invariants");
  if (!fs.existsSync(bobDir)) fs.mkdirSync(bobDir, { recursive: true });
  return bobDir;
}

function classifyFoundryOutcome(rawResult) {
  if (!isPlainObject(rawResult)) return "unknown";
  if (rawResult.kind === "foundry_fork") return "fork_blocked";
  if (rawResult.kind === "forge_not_in_path") return "forge_missing";
  if (Array.isArray(rawResult.tests)) {
    const failures = rawResult.tests.filter((t) => t && t.success === false);
    if (failures.length > 0) return "test_failed";
    if (rawResult.tests.length > 0) return "test_passed";
  }
  if (typeof rawResult.success === "boolean") {
    return rawResult.success ? "test_passed" : "test_failed";
  }
  return "unknown";
}

async function runInvariantForFinding({
  target_domain,
  finding,
  template_id,
  slot_values,
  harness_path,
  foundry_run,
  match_contract,
  match_test,
  chain_id,
  fork_block,
  fork_urls,
  extra_args,
  timeout_ms,
  run_id,
  dry_run,
}) {
  const domain = assertSafeDomain(target_domain);
  if (!isPlainObject(finding)) {
    throw new Error("finding must be an object");
  }
  if (typeof harness_path !== "string" || harness_path.length === 0) {
    throw new Error("harness_path must be a non-empty string");
  }
  if (typeof foundry_run !== "function" && dry_run !== true) {
    throw new Error("foundry_run must be a function (or pass dry_run: true)");
  }
  const suggestion = suggestInvariantsForFinding(finding, { slot_values });
  if (suggestion.suggestions.length === 0) {
    return {
      target_domain: domain,
      vulnerability_class: suggestion.vulnerability_class,
      missing_class: suggestion.missing_class === true,
      template_id: null,
      outcome: "no_template",
    };
  }
  const chosen = template_id
    ? suggestion.suggestions.find((s) => s.template_id === template_id)
    : suggestion.suggestions[0];
  if (!chosen) {
    throw new Error(`No matching template for class ${suggestion.vulnerability_class} (template_id=${template_id})`);
  }
  const { contract_name, function_name } = deriveTestNamesFromTemplate(chosen, finding);
  const renamedBody = renameTestFunction(chosen.foundry_test, function_name);
  const source = buildTestSource({ contractName: contract_name, functionBody: renamedBody });
  let writtenPath = null;
  let foundryRawResult = null;
  let outcome = "dry_run";
  let runHash = null;
  if (dry_run !== true) {
    const bobDir = ensureHarnessTestDir(harness_path);
    writtenPath = path.join(bobDir, `${contract_name}.t.sol`);
    fs.writeFileSync(writtenPath, source, "utf8");
    foundryRawResult = await foundry_run({
      target_domain: domain,
      harness_path,
      match_test: match_test || function_name,
      match_contract: match_contract || contract_name,
      chain_id,
      fork_block,
      fork_urls,
      extra_args,
      timeout_ms,
    });
    if (typeof foundryRawResult === "string") {
      try {
        foundryRawResult = JSON.parse(foundryRawResult);
      } catch (_err) {
        // leave as string for downstream inspection.
      }
    }
    outcome = classifyFoundryOutcome(foundryRawResult);
    runHash = hashCanonicalJson({
      finding_hash: finding.finding_hash,
      template_id: chosen.template_id,
      slot_values: slot_values || null,
      contract_name,
      function_name,
    });
  } else {
    runHash = hashCanonicalJson({
      finding_hash: finding.finding_hash,
      template_id: chosen.template_id,
      slot_values: slot_values || null,
      contract_name,
      function_name,
      dry_run: true,
    });
  }
  const record = {
    run_hash: runHash,
    target_domain: domain,
    finding_hash: finding.finding_hash || null,
    finding_title: finding.title || null,
    vulnerability_class: suggestion.vulnerability_class,
    template_id: chosen.template_id,
    slot_values: slot_values || null,
    unfilled_slots: chosen.unfilled_slots,
    contract_name,
    function_name,
    test_path: writtenPath,
    outcome,
    foundry_result: foundryRawResult,
    dry_run: dry_run === true,
    run_id: typeof run_id === "string" && run_id.length > 0 ? run_id : null,
    recorded_at: new Date().toISOString(),
  };
  if (dry_run !== true) {
    ensureSessionDir(domain);
    const filePath = invariantRunsJsonlPath(domain);
    const existing = readJsonlRuns(filePath);
    const byHash = new Map();
    for (const run of existing) {
      if (run && typeof run.run_hash === "string") byHash.set(run.run_hash, run);
    }
    byHash.set(runHash, record);
    writeJsonlRuns(filePath, Array.from(byHash.values()));
  }
  return {
    target_domain: domain,
    vulnerability_class: suggestion.vulnerability_class,
    template_id: chosen.template_id,
    contract_name,
    function_name,
    test_path: writtenPath,
    outcome,
    unfilled_slots: chosen.unfilled_slots,
    run_hash: runHash,
    dry_run: dry_run === true,
    foundry_result: foundryRawResult,
  };
}

function readInvariantRuns({ target_domain, outcome_filter, template_id_filter, limit }) {
  const domain = assertSafeDomain(target_domain);
  const filePath = invariantRunsJsonlPath(domain);
  const records = readJsonlRuns(filePath);
  if (records.length === 0) {
    return { runs: [], total_in_corpus: 0, total_matched: 0 };
  }
  const matched = [];
  for (const run of records) {
    if (!isPlainObject(run)) continue;
    if (outcome_filter && run.outcome !== outcome_filter) continue;
    if (template_id_filter && run.template_id !== template_id_filter) continue;
    matched.push(run);
  }
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;
  return {
    runs: matched.slice(0, cap),
    total_in_corpus: records.length,
    total_matched: matched.length,
  };
}

module.exports = {
  runInvariantForFinding,
  readInvariantRuns,
  buildTestSource,
  deriveTestNamesFromTemplate,
  renameTestFunction,
  classifyFoundryOutcome,
};
