"use strict";

const TEMPLATES = Object.freeze([
  Object.freeze({
    id: "INV-REENTRANCY-CALLBACK-001",
    vulnerability_class: "reentrancy",
    name: "External-call-then-state-update reentrancy",
    description: "Asserts that a withdraw-style function reverts when the recipient is a contract whose receive callback re-enters the same function before state updates apply.",
    parameter_slots: ["target_contract", "vulnerable_function", "withdraw_amount"],
    foundry_test_template: [
      "function testReentrancyDuringExternalCall() public {",
      "    Reenterer attacker = new Reenterer({TARGET_CONTRACT}(address(target)));",
      "    deal(address(target), 10 ether);",
      "    vm.prank(address(attacker));",
      "    target.{VULNERABLE_FUNCTION}({WITHDRAW_AMOUNT});",
      "    assertGt(address(attacker).balance, {WITHDRAW_AMOUNT});",
      "}",
    ].join("\n"),
  }),
  Object.freeze({
    id: "INV-ACCESS-CONTROL-EOA-001",
    vulnerability_class: "access_control",
    name: "Unauthorized EOA can call admin function",
    description: "Asserts that a privileged function reverts when called from a fresh EOA without the admin role.",
    parameter_slots: ["target_contract", "admin_function", "admin_role_check"],
    foundry_test_template: [
      "function testUnauthorizedCallerReverts() public {",
      "    address attacker = makeAddr(\"attacker\");",
      "    vm.expectRevert();",
      "    vm.prank(attacker);",
      "    {TARGET_CONTRACT}.{ADMIN_FUNCTION}();",
      "}",
    ].join("\n"),
  }),
  Object.freeze({
    id: "INV-ARITH-OVERFLOW-MAX-001",
    vulnerability_class: "arithmetic_overflow",
    name: "Edge-value arithmetic overflow",
    description: "Asserts that arithmetic on type(uint256).max-bordering inputs reverts (Solidity 0.8+) or returns the expected sentinel (older versions).",
    parameter_slots: ["target_contract", "vulnerable_function"],
    foundry_test_template: [
      "function testOverflowOnMaxInputReverts() public {",
      "    vm.expectRevert();",
      "    {TARGET_CONTRACT}.{VULNERABLE_FUNCTION}(type(uint256).max);",
      "}",
    ].join("\n"),
  }),
  Object.freeze({
    id: "INV-ORACLE-MANIPULATION-SPOT-001",
    vulnerability_class: "oracle_manipulation",
    name: "Spot-price oracle manipulation via flash deposit",
    description: "Asserts that a price-dependent action reverts when the oracle's spot price is moved within the same transaction by a flash-loan-funded swap.",
    parameter_slots: ["oracle_contract", "victim_function", "swap_pool"],
    foundry_test_template: [
      "function testSpotPriceManipulationReverts() public {",
      "    vm.startPrank(makeAddr(\"flashUser\"));",
      "    deal(address({SWAP_POOL}.token0()), msg.sender, 1_000_000e18);",
      "    {SWAP_POOL}.swap(1_000_000e18, 0, address(this), \"\");",
      "    vm.expectRevert();",
      "    {VICTIM_FUNCTION}();",
      "    vm.stopPrank();",
      "}",
    ].join("\n"),
  }),
  Object.freeze({
    id: "INV-UNCHECKED-CALL-RETURN-001",
    vulnerability_class: "unchecked_call",
    name: "Low-level call return value ignored",
    description: "Asserts that a low-level external call's return value is checked by causing the callee to revert and observing whether the caller propagates the failure.",
    parameter_slots: ["target_contract", "vulnerable_function", "callee_contract"],
    foundry_test_template: [
      "function testLowLevelCallReturnIsChecked() public {",
      "    vm.mockCall(address({CALLEE_CONTRACT}), abi.encodeWithSelector(bytes4(keccak256(\"anything()\"))), abi.encode(false));",
      "    vm.expectRevert();",
      "    {TARGET_CONTRACT}.{VULNERABLE_FUNCTION}();",
      "}",
    ].join("\n"),
  }),
  Object.freeze({
    id: "INV-SIGNATURE-REPLAY-001",
    vulnerability_class: "signature_validation",
    name: "Signature replay across chains or accounts",
    description: "Asserts that a signature accepted on one chain or by one account is rejected when replayed on another (no chain ID or nonce binding).",
    parameter_slots: ["target_contract", "vulnerable_function"],
    foundry_test_template: [
      "function testSignatureReplayRejected() public {",
      "    bytes memory sig = makeSig(/* domain */ 1, /* message */ \"x\");",
      "    {TARGET_CONTRACT}.{VULNERABLE_FUNCTION}(sig);",
      "    vm.expectRevert();",
      "    {TARGET_CONTRACT}.{VULNERABLE_FUNCTION}(sig);",
      "}",
    ].join("\n"),
  }),
  Object.freeze({
    id: "INV-DELEGATECALL-STORAGE-001",
    vulnerability_class: "delegatecall_storage",
    name: "Storage collision via delegatecall",
    description: "Asserts that a delegatecall'd implementation cannot rewrite the proxy's storage slot 0 (admin).",
    parameter_slots: ["proxy_contract", "implementation_contract"],
    foundry_test_template: [
      "function testStorageSlotZeroProtected() public {",
      "    address admin_before = address(uint160(uint256(vm.load(address({PROXY_CONTRACT}), bytes32(uint256(0))))));",
      "    {PROXY_CONTRACT}.delegateToImpl(abi.encodeWithSignature(\"writeSlotZero(bytes32)\", bytes32(uint256(uint160(makeAddr(\"hijack\"))))));",
      "    address admin_after = address(uint160(uint256(vm.load(address({PROXY_CONTRACT}), bytes32(uint256(0))))));",
      "    assertEq(admin_after, admin_before);",
      "}",
    ].join("\n"),
  }),
]);

const TEMPLATES_BY_CLASS = (() => {
  const map = new Map();
  for (const template of TEMPLATES) {
    if (!map.has(template.vulnerability_class)) map.set(template.vulnerability_class, []);
    map.get(template.vulnerability_class).push(template);
  }
  return map;
})();

const SUPPORTED_CLASSES = Object.freeze(Array.from(TEMPLATES_BY_CLASS.keys()).sort());

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function getTemplatesForClass(vulnerabilityClass) {
  if (typeof vulnerabilityClass !== "string") return [];
  return (TEMPLATES_BY_CLASS.get(vulnerabilityClass) || []).slice();
}

function fillSlots(template, values) {
  let body = template.foundry_test_template;
  if (!isPlainObject(values)) return body;
  for (const slot of template.parameter_slots) {
    const placeholder = `{${slot.toUpperCase()}}`;
    if (Object.prototype.hasOwnProperty.call(values, slot)) {
      const value = values[slot];
      body = body.split(placeholder).join(String(value));
    }
  }
  return body;
}

function suggestInvariantsForFinding(finding, options) {
  if (!isPlainObject(finding)) {
    throw new TypeError("finding must be an object");
  }
  const vulnerabilityClass = typeof finding.vulnerability_class === "string"
    ? finding.vulnerability_class
    : "unknown";
  const templates = getTemplatesForClass(vulnerabilityClass);
  if (templates.length === 0) {
    return {
      vulnerability_class: vulnerabilityClass,
      template_count: 0,
      suggestions: [],
      missing_class: !SUPPORTED_CLASSES.includes(vulnerabilityClass),
    };
  }
  const limit = options && Number.isInteger(options.limit) && options.limit > 0
    ? Math.min(options.limit, 25)
    : templates.length;
  const slotValues = options && isPlainObject(options.slot_values) ? options.slot_values : null;
  const suggestions = templates.slice(0, limit).map((template) => ({
    template_id: template.id,
    name: template.name,
    description: template.description,
    parameter_slots: template.parameter_slots,
    unfilled_slots: slotValues
      ? template.parameter_slots.filter((slot) => !Object.prototype.hasOwnProperty.call(slotValues, slot))
      : template.parameter_slots.slice(),
    foundry_test: fillSlots(template, slotValues || {}),
  }));
  return {
    vulnerability_class: vulnerabilityClass,
    template_count: templates.length,
    suggestions,
    missing_class: false,
  };
}

function suggestInvariantsForReport(parsedReport, options) {
  if (!isPlainObject(parsedReport) || !Array.isArray(parsedReport.findings)) {
    throw new TypeError("parsedReport must be an object with findings array");
  }
  const slotValuesByClass = options && isPlainObject(options.slot_values_by_class)
    ? options.slot_values_by_class
    : {};
  const grouped = {};
  for (const finding of parsedReport.findings) {
    if (!isPlainObject(finding)) continue;
    const vulnerabilityClass = typeof finding.vulnerability_class === "string"
      ? finding.vulnerability_class
      : "unknown";
    const slotValues = slotValuesByClass[vulnerabilityClass] || null;
    const suggestion = suggestInvariantsForFinding(finding, {
      slot_values: slotValues,
      limit: options && options.per_finding_limit,
    });
    if (!grouped[vulnerabilityClass]) grouped[vulnerabilityClass] = { count: 0, suggestions: [] };
    grouped[vulnerabilityClass].count += 1;
    grouped[vulnerabilityClass].suggestions.push({
      finding_index: finding.finding_index,
      finding_title: finding.title,
      finding_hash: finding.finding_hash,
      ...suggestion,
    });
  }
  return {
    total_templates: TEMPLATES.length,
    supported_classes: SUPPORTED_CLASSES,
    by_class: grouped,
  };
}

module.exports = {
  TEMPLATES,
  SUPPORTED_CLASSES,
  getTemplatesForClass,
  suggestInvariantsForFinding,
  suggestInvariantsForReport,
};
