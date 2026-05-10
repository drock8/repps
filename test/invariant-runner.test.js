"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  runInvariantForFinding,
  readInvariantRuns,
  buildTestSource,
  deriveTestNamesFromTemplate,
  renameTestFunction,
  classifyFoundryOutcome,
} = require("../mcp/lib/invariant-runner.js");

function uniqueDomain(prefix = "bob-invariant-runner-test") {
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${prefix}-${suffix}.local`;
}

function cleanupDomain(domain) {
  const dir = path.join(os.homedir(), "bounty-agent-sessions", domain);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function makeHarness() {
  const harness = fs.mkdtempSync(path.join(os.tmpdir(), "bob-foundry-harness-"));
  fs.mkdirSync(path.join(harness, "test"), { recursive: true });
  return harness;
}

function cleanupHarness(harnessPath) {
  if (harnessPath && fs.existsSync(harnessPath)) {
    fs.rmSync(harnessPath, { recursive: true, force: true });
  }
}

const SAMPLE_REENTRANCY_FINDING = Object.freeze({
  finding_hash: "h1",
  title: "Reentrancy in withdraw",
  vulnerability_class: "reentrancy",
  description: "external call before state update",
});

test("renameTestFunction swaps the function identifier without touching the body", () => {
  const original = "function testFoo() public { assertTrue(true); }";
  const renamed = renameTestFunction(original, "testNewName");
  assert.match(renamed, /function testNewName\(/);
  assert.match(renamed, /assertTrue\(true\)/);
  assert.doesNotMatch(renamed, /testFoo/);
});

test("buildTestSource produces a valid Solidity test contract envelope", () => {
  const source = buildTestSource({ contractName: "MyTest", functionBody: "function testX() public {}" });
  assert.match(source, /pragma solidity/);
  assert.match(source, /contract MyTest is Test \{/);
  assert.match(source, /function testX\(\) public \{\}/);
  assert.match(source, /function setUp\(\) public virtual/);
});

test("deriveTestNamesFromTemplate produces stable, sanitized identifiers", () => {
  const template = { template_id: "INV-REENTRANCY-CALLBACK-001", foundry_test: "function testFoo() {}" };
  const a = deriveTestNamesFromTemplate(template, SAMPLE_REENTRANCY_FINDING);
  const b = deriveTestNamesFromTemplate(template, SAMPLE_REENTRANCY_FINDING);
  assert.deepEqual(a, b);
  assert.match(a.contract_name, /^BobInvariantTest_/);
  assert.match(a.function_name, /^testBobInvariant_/);
});

test("classifyFoundryOutcome maps tests array, kind tags, and success flag", () => {
  assert.equal(classifyFoundryOutcome({ tests: [{ success: true }] }), "test_passed");
  assert.equal(classifyFoundryOutcome({ tests: [{ success: false }] }), "test_failed");
  assert.equal(classifyFoundryOutcome({ kind: "foundry_fork" }), "fork_blocked");
  assert.equal(classifyFoundryOutcome({ kind: "forge_not_in_path" }), "forge_missing");
  assert.equal(classifyFoundryOutcome({ success: true }), "test_passed");
  assert.equal(classifyFoundryOutcome({ success: false }), "test_failed");
  assert.equal(classifyFoundryOutcome({}), "unknown");
});

test("dry_run returns a report without writing the test file or persisting", async () => {
  const domain = uniqueDomain();
  const harness = makeHarness();
  try {
    const result = await runInvariantForFinding({
      target_domain: domain,
      finding: SAMPLE_REENTRANCY_FINDING,
      slot_values: { target_contract: "Pool", vulnerable_function: "withdraw", withdraw_amount: "1 ether" },
      harness_path: harness,
      dry_run: true,
    });
    assert.equal(result.dry_run, true);
    assert.equal(result.outcome, "dry_run");
    assert.match(result.contract_name, /^BobInvariantTest_/);
    assert.equal(result.test_path, null);
    const corpus = readInvariantRuns({ target_domain: domain });
    assert.equal(corpus.total_in_corpus, 0);
  } finally {
    cleanupDomain(domain);
    cleanupHarness(harness);
  }
});

test("runInvariantForFinding writes the test file, dispatches foundry_run, and persists the result", async () => {
  const domain = uniqueDomain();
  const harness = makeHarness();
  let foundryCall = null;
  const stubFoundry = async (args) => {
    foundryCall = args;
    return { tests: [{ name: "testX", success: true, gas: 12345 }] };
  };
  try {
    const result = await runInvariantForFinding({
      target_domain: domain,
      finding: SAMPLE_REENTRANCY_FINDING,
      slot_values: { target_contract: "Pool", vulnerable_function: "withdraw", withdraw_amount: "1 ether" },
      harness_path: harness,
      foundry_run: stubFoundry,
      run_id: "inv-001",
    });
    assert.equal(result.outcome, "test_passed");
    assert.ok(result.test_path && fs.existsSync(result.test_path));
    assert.equal(foundryCall.harness_path, harness);
    assert.equal(foundryCall.match_test, result.function_name);
    const corpus = readInvariantRuns({ target_domain: domain });
    assert.equal(corpus.total_in_corpus, 1);
    assert.equal(corpus.runs[0].run_id, "inv-001");
    assert.equal(corpus.runs[0].outcome, "test_passed");
  } finally {
    cleanupDomain(domain);
    cleanupHarness(harness);
  }
});

test("re-running the same (finding, template, slot_values) upserts the same run_hash", async () => {
  const domain = uniqueDomain();
  const harness = makeHarness();
  const stubFoundry = async () => ({ tests: [{ success: true }] });
  try {
    const first = await runInvariantForFinding({
      target_domain: domain,
      finding: SAMPLE_REENTRANCY_FINDING,
      slot_values: { target_contract: "Pool", vulnerable_function: "withdraw", withdraw_amount: "1 ether" },
      harness_path: harness,
      foundry_run: stubFoundry,
    });
    const second = await runInvariantForFinding({
      target_domain: domain,
      finding: SAMPLE_REENTRANCY_FINDING,
      slot_values: { target_contract: "Pool", vulnerable_function: "withdraw", withdraw_amount: "1 ether" },
      harness_path: harness,
      foundry_run: stubFoundry,
    });
    assert.equal(first.run_hash, second.run_hash);
    const corpus = readInvariantRuns({ target_domain: domain });
    assert.equal(corpus.total_in_corpus, 1);
  } finally {
    cleanupDomain(domain);
    cleanupHarness(harness);
  }
});

test("missing class returns no_template and does not invoke foundry_run", async () => {
  const domain = uniqueDomain();
  const harness = makeHarness();
  let called = false;
  const stubFoundry = async () => { called = true; return {}; };
  try {
    const result = await runInvariantForFinding({
      target_domain: domain,
      finding: { finding_hash: "x", vulnerability_class: "no_such_class" },
      harness_path: harness,
      foundry_run: stubFoundry,
    });
    assert.equal(result.outcome, "no_template");
    assert.equal(result.template_id, null);
    assert.equal(called, false);
  } finally {
    cleanupDomain(domain);
    cleanupHarness(harness);
  }
});

test("foundry_fork kind classifies as fork_blocked outcome", async () => {
  const domain = uniqueDomain();
  const harness = makeHarness();
  const stubFoundry = async () => ({ kind: "foundry_fork", reason: "rpc unavailable" });
  try {
    const result = await runInvariantForFinding({
      target_domain: domain,
      finding: SAMPLE_REENTRANCY_FINDING,
      slot_values: { target_contract: "Pool", vulnerable_function: "withdraw", withdraw_amount: "1 ether" },
      harness_path: harness,
      foundry_run: stubFoundry,
    });
    assert.equal(result.outcome, "fork_blocked");
  } finally {
    cleanupDomain(domain);
    cleanupHarness(harness);
  }
});

test("readInvariantRuns filters by outcome and template_id", async () => {
  const domain = uniqueDomain();
  const harness = makeHarness();
  const passing = async () => ({ tests: [{ success: true }] });
  const failing = async () => ({ tests: [{ success: false }] });
  try {
    await runInvariantForFinding({
      target_domain: domain,
      finding: SAMPLE_REENTRANCY_FINDING,
      slot_values: { target_contract: "PoolA", vulnerable_function: "withdraw", withdraw_amount: "1" },
      harness_path: harness,
      foundry_run: passing,
    });
    await runInvariantForFinding({
      target_domain: domain,
      finding: { ...SAMPLE_REENTRANCY_FINDING, finding_hash: "h2" },
      slot_values: { target_contract: "PoolB", vulnerable_function: "withdraw", withdraw_amount: "2" },
      harness_path: harness,
      foundry_run: failing,
    });
    const passed = readInvariantRuns({ target_domain: domain, outcome_filter: "test_passed" });
    assert.equal(passed.total_matched, 1);
    const failed = readInvariantRuns({ target_domain: domain, outcome_filter: "test_failed" });
    assert.equal(failed.total_matched, 1);
  } finally {
    cleanupDomain(domain);
    cleanupHarness(harness);
  }
});

test("missing harness test/ directory throws a clear error", async () => {
  const domain = uniqueDomain();
  const noTestHarness = fs.mkdtempSync(path.join(os.tmpdir(), "bob-no-test-harness-"));
  try {
    await assert.rejects(
      () => runInvariantForFinding({
        target_domain: domain,
        finding: SAMPLE_REENTRANCY_FINDING,
        slot_values: { target_contract: "Pool", vulnerable_function: "withdraw", withdraw_amount: "1" },
        harness_path: noTestHarness,
        foundry_run: async () => ({}),
      }),
      /test\/ directory/,
    );
  } finally {
    cleanupDomain(domain);
    cleanupHarness(noTestHarness);
  }
});

test("input validation rejects unsafe target_domain and missing finding/harness_path/foundry_run", async () => {
  await assert.rejects(
    () => runInvariantForFinding({
      target_domain: "../escape",
      finding: SAMPLE_REENTRANCY_FINDING,
      harness_path: "/tmp",
      foundry_run: async () => ({}),
    }),
    /target_domain/,
  );
  await assert.rejects(
    () => runInvariantForFinding({
      target_domain: "ok.example",
      finding: null,
      harness_path: "/tmp",
      foundry_run: async () => ({}),
    }),
    /finding/,
  );
  await assert.rejects(
    () => runInvariantForFinding({
      target_domain: "ok.example",
      finding: SAMPLE_REENTRANCY_FINDING,
      harness_path: "",
      foundry_run: async () => ({}),
    }),
    /harness_path/,
  );
  await assert.rejects(
    () => runInvariantForFinding({
      target_domain: "ok.example",
      finding: SAMPLE_REENTRANCY_FINDING,
      harness_path: "/tmp",
      foundry_run: null,
    }),
    /foundry_run/,
  );
});
