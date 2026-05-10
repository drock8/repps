"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TEMPLATES,
  SUPPORTED_CLASSES,
  getTemplatesForClass,
  suggestInvariantsForFinding,
  suggestInvariantsForReport,
} = require("../mcp/lib/invariant-template-corpus.js");

test("SUPPORTED_CLASSES covers the smart-contract bug classes IP4 emits", () => {
  for (const cls of [
    "reentrancy",
    "access_control",
    "arithmetic_overflow",
    "oracle_manipulation",
    "unchecked_call",
    "signature_validation",
    "delegatecall_storage",
  ]) {
    assert.ok(SUPPORTED_CLASSES.includes(cls), `${cls} present`);
  }
});

test("TEMPLATES every entry declares id, vulnerability_class, name, parameter_slots, and foundry_test_template", () => {
  for (const template of TEMPLATES) {
    assert.ok(typeof template.id === "string" && template.id.length > 0);
    assert.ok(typeof template.vulnerability_class === "string");
    assert.ok(typeof template.name === "string" && template.name.length > 0);
    assert.ok(Array.isArray(template.parameter_slots));
    assert.ok(typeof template.foundry_test_template === "string" && template.foundry_test_template.length > 0);
  }
});

test("getTemplatesForClass returns the templates whose vulnerability_class matches", () => {
  const reentrancy = getTemplatesForClass("reentrancy");
  assert.ok(reentrancy.length >= 1);
  assert.ok(reentrancy.every((t) => t.vulnerability_class === "reentrancy"));
});

test("getTemplatesForClass returns an empty array for unknown classes", () => {
  assert.deepEqual(getTemplatesForClass("nope"), []);
  assert.deepEqual(getTemplatesForClass(""), []);
});

test("suggestInvariantsForFinding emits suggestions when class is supported", () => {
  const result = suggestInvariantsForFinding({
    title: "Reentrancy in withdraw",
    vulnerability_class: "reentrancy",
  });
  assert.equal(result.vulnerability_class, "reentrancy");
  assert.ok(result.template_count >= 1);
  assert.ok(result.suggestions.length >= 1);
  assert.equal(result.missing_class, false);
});

test("suggestInvariantsForFinding flags missing_class for unsupported vulnerability_class", () => {
  const result = suggestInvariantsForFinding({ vulnerability_class: "nope" });
  assert.equal(result.template_count, 0);
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.missing_class, true);
});

test("slot_values fill placeholders and unfilled_slots reports the gap", () => {
  const result = suggestInvariantsForFinding({ vulnerability_class: "access_control" }, {
    slot_values: { target_contract: "Pool", admin_function: "emergencyPause" },
  });
  assert.equal(result.suggestions.length, 1);
  const suggestion = result.suggestions[0];
  assert.match(suggestion.foundry_test, /Pool\.emergencyPause/);
  assert.deepEqual(suggestion.unfilled_slots, ["admin_role_check"]);
});

test("missing slot_values keeps placeholders intact and unfilled_slots lists every slot", () => {
  const result = suggestInvariantsForFinding({ vulnerability_class: "reentrancy" });
  const suggestion = result.suggestions[0];
  assert.match(suggestion.foundry_test, /\{TARGET_CONTRACT\}/);
  assert.equal(suggestion.unfilled_slots.length, suggestion.parameter_slots.length);
});

test("limit clamps suggestion count below the hard ceiling", () => {
  const result = suggestInvariantsForFinding({ vulnerability_class: "reentrancy" }, { limit: 1 });
  assert.equal(result.suggestions.length, 1);
});

test("suggestInvariantsForReport groups suggestions per vulnerability_class", () => {
  const parsed = {
    findings: [
      { finding_index: 0, title: "Reentrancy", vulnerability_class: "reentrancy", finding_hash: "h1" },
      { finding_index: 1, title: "Access bypass", vulnerability_class: "access_control", finding_hash: "h2" },
      { finding_index: 2, title: "Reentrancy 2", vulnerability_class: "reentrancy", finding_hash: "h3" },
    ],
  };
  const result = suggestInvariantsForReport(parsed);
  assert.equal(result.total_templates, TEMPLATES.length);
  assert.equal(result.by_class.reentrancy.count, 2);
  assert.equal(result.by_class.access_control.count, 1);
  assert.equal(result.by_class.reentrancy.suggestions[0].finding_title, "Reentrancy");
});

test("suggestInvariantsForReport rejects malformed input", () => {
  assert.throws(() => suggestInvariantsForReport(null), /parsedReport/);
  assert.throws(() => suggestInvariantsForReport({}), /findings/);
});

test("template ids are unique", () => {
  const ids = new Set();
  for (const template of TEMPLATES) {
    assert.ok(!ids.has(template.id), `duplicate template id: ${template.id}`);
    ids.add(template.id);
  }
});
