"use strict";

const fs = require("fs");
const path = require("path");
const {
  assertBoolean,
  assertNonEmptyString,
  normalizeOptionalText,
  parseAgentId,
  parseWaveId,
} = require("./validation.js");
const {
  loadWaveAssignments,
} = require("./assignments.js");
const {
  readSessionStateStrict,
} = require("./session-state.js");
const {
  readAttackSurfaceStrict,
} = require("./attack-surface.js");
const {
  rankAttackSurfaces,
} = require("./ranking.js");
const {
  buildCoverageSummaryForSurface,
  readCoverageRecordsFromJsonl,
} = require("./coverage.js");
const {
  buildCircuitBreakerSummary,
  readHttpAuditRecordsFromJsonl,
  readTrafficRecordsFromJsonl,
  summarizeHttpAuditRecords,
  summarizeTrafficRecords,
} = require("./http-records.js");
const {
  summarizePublicIntelForSurface,
} = require("./public-intel.js");
const {
  summarizeStaticScanHints,
} = require("./static-artifacts.js");
const {
  loadBobSpec,
  summarizeBobSpecForBrief,
} = require("./bob-spec.js");
const {
  summarizeRpcPoolForBrief,
} = require("./evm-rpc-pool.js");
const {
  filterExclusionsByHosts,
} = require("./scope.js");
const {
  readResourceText,
  resourceCandidatePaths,
} = require("./runtime-resources.js");
const {
  normalizeAssignmentRouteMetadata,
} = require("./capability-packs.js");

// Bypass table tech-to-file map used by hunter brief generation.
const BYPASS_TABLE_MAP = {
  wordpress: "wordpress.txt",
  graphql: "graphql.txt",
  ssrf: "ssrf.txt",
  jwt: "jwt.txt",
  firebase: "firebase.txt",
  "next.js": "nextjs.txt",
  nextjs: "nextjs.txt",
  oauth: "oauth-oidc.txt",
  oidc: "oauth-oidc.txt",
};
const BYPASS_TABLE_DEFAULT = "rest-api.txt";
const HUNTER_KNOWLEDGE_FILE = Object.freeze(["knowledge", "hunter-techniques.json"]);
const HUNTER_KNOWLEDGE_DEFAULT_ID = "generic-rest-api";
const HUNTER_KNOWLEDGE_MAX_ENTRIES = 4;
const HUNTER_KNOWLEDGE_MAX_CHARS = 4500;
const HUNTER_BRIEF_SURFACE_ARRAY_LIMITS = Object.freeze({
  hosts: 20,
  tech_stack: 20,
  endpoints: 80,
  interesting_params: 40,
  nuclei_hits: 30,
  bug_class_hints: 20,
  high_value_flows: 20,
  evidence: 25,
  fork_rpc_pool: 6,
});
const HUNTER_BRIEF_SURFACE_SCALAR_LIMITS = Object.freeze({
  id: 120,
  priority: 40,
  original_priority: 40,
  surface_type: 80,
  chain_family: 40,
  chain_id: 20,
  // Per-chain harness paths. Each smart-contract hunter prompt expects a
  // chain-specific scalar — whitelisting them all keeps slim surfaces lossy
  // only on cap, not on field name. Adding a new chain pack is one entry.
  foundry_harness_path: 240,    // EVM
  anchor_harness_path: 240,     // SVM
  move_harness_path: 240,       // Aptos + Sui (Move pack)
  ink_harness_path: 240,        // Substrate ink!
  cargo_harness_path: 240,      // Generic Cargo (Substrate / CosmWasm fallback)
  cosmwasm_harness_path: 240,   // CosmWasm explicit
  name: 160,
  title: 160,
  description: 500,
});
const HUNTER_BRIEF_ARRAY_ITEM_MAX_CHARS = 500;
const HUNTER_BRIEF_RANKING_REASON_LIMIT = 10;
const HUNTER_BRIEF_RANKING_REASON_MAX_CHARS = 160;

// Default brief message returned when bob-spec.json is absent. The loader is
// real (mcp/lib/bob-spec.js); this message is the empty-state fallback.
const BOB_SPEC_ABSENT_MESSAGE = "bob-spec.json not present in the session directory; the smart_contract anti-stop rule still applies (record at least one bypass_attempts[] entry citing the trust assumption you actually attempted to break, or record a finding).";

function resolveBypassTable(techStack) {
  if (!Array.isArray(techStack)) return BYPASS_TABLE_DEFAULT;
  for (const tech of techStack) {
    const key = String(tech).toLowerCase();
    for (const [pattern, file] of Object.entries(BYPASS_TABLE_MAP)) {
      if (key.includes(pattern)) return file;
    }
  }
  return BYPASS_TABLE_DEFAULT;
}

function hunterKnowledgeCandidatePaths() {
  return resourceCandidatePaths(...HUNTER_KNOWLEDGE_FILE);
}

function loadHunterKnowledge() {
  for (const candidate of hunterKnowledgeCandidatePaths()) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) {
        return {
          path: candidate,
          entries: parsed.entries.filter((entry) => entry && typeof entry === "object"),
        };
      }
    } catch {
      // Knowledge is read-only enrichment. A malformed optional file should not
      // block a hunter from receiving the deterministic assignment brief.
    }
  }
  return { path: null, entries: [] };
}

function lowerStringArray(value) {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item) => item != null)
    .map((item) => String(item).toLowerCase());
}

function stringArray(value) {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item) => item != null)
    .map((item) => String(item));
}

function surfaceFieldText(surface, fields) {
  const values = [];
  for (const field of fields) {
    values.push(...lowerStringArray(surface[field]));
  }
  return values.join("\n");
}

function countMatches(patterns, haystack, weight, label) {
  const matches = [];
  let score = 0;
  for (const pattern of lowerStringArray(patterns)) {
    if (!pattern || !haystack.includes(pattern)) continue;
    score += weight;
    matches.push(`${label}:${pattern}`);
  }
  return { score, matches };
}

function countExactMatches(patterns, values, weight, label) {
  const valueSet = new Set(lowerStringArray(values));
  const matches = [];
  let score = 0;
  for (const pattern of lowerStringArray(patterns)) {
    if (!pattern || !valueSet.has(pattern)) continue;
    score += weight;
    matches.push(`${label}:${pattern}`);
  }
  return { score, matches };
}

function scoreKnowledgeEntry(entry, surface) {
  const match = entry.match && typeof entry.match === "object" ? entry.match : {};
  const techText = surfaceFieldText(surface, [
    "tech_stack",
    "surface_type",
  ]);
  const endpointText = surfaceFieldText(surface, [
    "endpoints",
    "discovered_endpoints",
    "js_endpoints",
    "hosts",
    "high_value_flows",
    "evidence",
  ]);
  const paramValues = [
    ...lowerStringArray(surface.interesting_params),
    ...lowerStringArray(surface.params),
    ...lowerStringArray(surface.parameters),
  ];
  const hintText = surfaceFieldText(surface, [
    "nuclei_hits",
    "js_hints",
    "security_issues",
    "leaked_secrets",
    "auth_info",
    "surface_type",
    "bug_class_hints",
    "high_value_flows",
    "evidence",
  ]);

  const scored = [
    countMatches(match.tech, techText, 8, "tech"),
    countMatches(match.endpoints, endpointText, 5, "endpoint"),
    countExactMatches(match.params, paramValues, 3, "param"),
    countMatches(match.hints, hintText, 4, "hint"),
  ];

  return scored.reduce(
    (result, item) => ({
      score: result.score + item.score,
      matches: result.matches.concat(item.matches),
    }),
    { score: 0, matches: [] },
  );
}

function slimKnowledgeEntry(entry, matches) {
  return {
    id: assertNonEmptyString(entry.id || "knowledge-entry", "knowledge.id"),
    title: assertNonEmptyString(entry.title || entry.id || "Hunter guidance", "knowledge.title"),
    matched: matches.slice(0, 6),
    techniques: stringArray(entry.techniques)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4),
    payload_hints: stringArray(entry.payload_hints)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4),
  };
}

function fitKnowledgeEntries(entries, maxChars) {
  const selected = [];
  for (const entry of entries) {
    const candidate = selected.concat(entry);
    if (JSON.stringify(candidate).length > maxChars) break;
    selected.push(entry);
  }
  return selected;
}

function resolveHunterKnowledge(surface) {
  const knowledge = loadHunterKnowledge();
  if (knowledge.entries.length === 0) {
    return {
      techniques: [],
      payload_hints: [],
      knowledge_summary: {
        source: null,
        entries_returned: 0,
        capped: false,
        char_count: 0,
      },
    };
  }

  const scoredEntries = [];
  for (const entry of knowledge.entries) {
    const scored = scoreKnowledgeEntry(entry, surface);
    if (scored.score > 0) {
      scoredEntries.push({ entry, score: scored.score, matches: scored.matches });
    }
  }

  if (scoredEntries.length === 0) {
    const fallback = knowledge.entries.find((entry) => entry.id === HUNTER_KNOWLEDGE_DEFAULT_ID);
    if (fallback) {
      scoredEntries.push({ entry: fallback, score: 0, matches: ["fallback:generic-rest-api"] });
    }
  }

  scoredEntries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.entry.id || "").localeCompare(String(b.entry.id || ""));
  });

  const slimEntries = scoredEntries
    .slice(0, HUNTER_KNOWLEDGE_MAX_ENTRIES)
    .map(({ entry, matches }) => slimKnowledgeEntry(entry, matches));
  const fittedEntries = fitKnowledgeEntries(slimEntries, HUNTER_KNOWLEDGE_MAX_CHARS);
  let techniques = [];
  let payloadHints = [];
  let charCount = 0;
  while (fittedEntries.length > 0) {
    techniques = fittedEntries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      matched: entry.matched,
      guidance: entry.techniques,
    }));
    payloadHints = fittedEntries
      .filter((entry) => entry.payload_hints.length > 0)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        hints: entry.payload_hints,
      }));
    charCount = JSON.stringify({ techniques, payload_hints: payloadHints }).length;
    if (charCount <= HUNTER_KNOWLEDGE_MAX_CHARS) break;
    fittedEntries.pop();
  }
  if (fittedEntries.length === 0) {
    techniques = [];
    payloadHints = [];
    charCount = 0;
  }

  return {
    techniques,
    payload_hints: payloadHints,
    knowledge_summary: {
      source: knowledge.path ? path.basename(knowledge.path) : null,
      entries_returned: fittedEntries.length,
      capped: slimEntries.length > fittedEntries.length,
      char_count: charCount,
      max_chars: HUNTER_KNOWLEDGE_MAX_CHARS,
    },
  };
}

function isBriefScalar(value) {
  return value == null || ["string", "number", "boolean"].includes(typeof value);
}

function capStringValue(value, maxChars) {
  if (typeof value !== "string" || value.length <= maxChars) {
    return { value, truncated: false, total_chars: typeof value === "string" ? value.length : null };
  }
  return {
    value: value.slice(0, maxChars),
    truncated: true,
    total_chars: value.length,
  };
}

function cappedSurfaceArray(value, limit) {
  const values = Array.isArray(value)
    ? value
    : value == null
      ? []
      : [value];
  let truncatedValues = 0;
  const shownValues = values.filter((item) => item != null).slice(0, limit).map((item) => {
    const capped = capStringValue(String(item), HUNTER_BRIEF_ARRAY_ITEM_MAX_CHARS);
    if (capped.truncated) truncatedValues += 1;
    return capped.value;
  });
  const limits = {
    shown: shownValues.length,
    total: values.length,
    omitted: Math.max(0, values.length - shownValues.length),
  };
  if (truncatedValues > 0) {
    limits.truncated_values = truncatedValues;
    limits.max_value_chars = HUNTER_BRIEF_ARRAY_ITEM_MAX_CHARS;
  }
  return {
    values: shownValues,
    limits,
  };
}

function slimRankingForBrief(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ranking = {};
  if (Number.isFinite(value.version)) ranking.version = value.version;
  if (Number.isFinite(value.score)) ranking.score = value.score;
  if (isBriefScalar(value.priority)) {
    ranking.priority = capStringValue(String(value.priority), HUNTER_BRIEF_SURFACE_SCALAR_LIMITS.priority).value;
  }
  const cappedReasons = cappedSurfaceArray(value.reasons, HUNTER_BRIEF_RANKING_REASON_LIMIT);
  ranking.reasons = cappedReasons.values.map((reason) => {
    const capped = capStringValue(reason, HUNTER_BRIEF_RANKING_REASON_MAX_CHARS);
    return capped.value;
  });
  return ranking;
}

function slimSurfaceForBrief(surface) {
  const source = surface && typeof surface === "object" && !Array.isArray(surface) ? surface : {};
  const slimSurface = {};
  const surfaceLimits = {};

  for (const [field, maxChars] of Object.entries(HUNTER_BRIEF_SURFACE_SCALAR_LIMITS)) {
    const value = source[field];
    if (!isBriefScalar(value) || value == null) continue;
    const normalizedValue = typeof value === "string" ? value : String(value);
    const capped = capStringValue(normalizedValue, maxChars);
    slimSurface[field] = capped.value;
    if (capped.truncated) {
      surfaceLimits[field] = {
        shown_chars: capped.value.length,
        total_chars: capped.total_chars,
        omitted_chars: capped.total_chars - capped.value.length,
      };
    }
  }

  const ranking = slimRankingForBrief(source.ranking);
  if (ranking) {
    slimSurface.ranking = ranking;
  }

  for (const [field, limit] of Object.entries(HUNTER_BRIEF_SURFACE_ARRAY_LIMITS)) {
    const capped = cappedSurfaceArray(source[field], limit);
    slimSurface[field] = capped.values;
    surfaceLimits[field] = capped.limits;
  }

  return {
    surface: slimSurface,
    surface_limits: surfaceLimits,
  };
}

function readHunterBrief(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  const wave = parseWaveId(args.wave);
  const agent = parseAgentId(args.agent);
  const egressProfile = normalizeOptionalText(args.egress_profile, "egress_profile") || "default";
  const blockInternalHosts = args.block_internal_hosts == null
    ? false
    : assertBoolean(args.block_internal_hosts, "block_internal_hosts");
  const waveNumber = Number(wave.slice(1));

  // 1. Load and validate assignment
  const { assignmentByAgent } = loadWaveAssignments(domain, waveNumber);
  const assignment = assignmentByAgent.get(agent);
  if (!assignment) {
    throw new Error(`Agent ${agent} is not assigned in wave ${wave}`);
  }
  // normalizeAssignmentRouteMetadata already validates brief_profile against
  // the capability-packs registry; any registered profile (web today, plus
  // smart_contract_* once SC packs are added) is accepted by hunter-brief.
  const routeMetadata = normalizeAssignmentRouteMetadata(assignment);

  // 2. Load attack surface and find assigned surface
  const attackSurface = readAttackSurfaceStrict(domain);
  let surfacesForBrief = attackSurface.document.surfaces;
  // Ranking summarizes traffic + public intel per surface, neither of which
  // a smart-contract hunter consumes. Skip it for non-web profiles to avoid
  // paying that I/O cost for a result we'd just drop.
  const isSmartContractBrief = routeMetadata.brief_profile !== "web";
  if (!isSmartContractBrief) {
    try {
      const ranked = rankAttackSurfaces(domain, { write: false });
      if (ranked && Array.isArray(ranked.surfaces)) {
        surfacesForBrief = ranked.surfaces;
      }
    } catch {}
  }
  const surfaceObj = surfacesForBrief.find(
    (s) => s.id === assignment.surface_id,
  );
  if (!surfaceObj) {
    throw new Error(`Surface ${assignment.surface_id} not found in attack_surface.json`);
  }

  // 3. Read session state for exclusions
  const { state } = readSessionStateStrict(domain);

  const deadEndResult = filterExclusionsByHosts(state.dead_ends, surfaceObj.hosts);
  const wafResult = filterExclusionsByHosts(state.waf_blocked_endpoints, surfaceObj.hosts);
  const slimSurface = slimSurfaceForBrief(surfaceObj);
  // coverage_summary stays in both profiles: SC hunters call bounty_log_coverage
  // for chain-flavored bug-class taxonomies, and resumed waves want to know
  // what was already tested regardless of profile.
  const coverageSummary = buildCoverageSummaryForSurface(
    readCoverageRecordsFromJsonl(domain),
    assignment.surface_id,
  );

  // Dispatch explicitly on brief_profile. The capability-pack registry is
  // the source of truth for what profiles exist; an unknown profile is a
  // route-metadata bug, not a fall-through to SC.
  const profileExtras = buildBriefExtrasForProfile(routeMetadata.brief_profile, {
    domain,
    surface: surfaceObj,
    assignment,
  });

  return JSON.stringify({
    run_context: {
      target_domain: domain,
      phase: state.phase,
      auth_status: state.auth_status,
      egress_profile: egressProfile,
      block_internal_hosts: blockInternalHosts,
      capability_pack: routeMetadata.capability_pack,
      hunter_agent: routeMetadata.hunter_agent,
      brief_profile: routeMetadata.brief_profile,
    },
    target_url: state.target_url,
    wave,
    agent,
    surface: slimSurface.surface,
    surface_limits: slimSurface.surface_limits,
    valid_surface_ids: attackSurface.surface_ids,
    dead_ends: deadEndResult.filtered,
    waf_blocked_endpoints: wafResult.filtered,
    exclusions_summary: {
      dead_ends_total: deadEndResult.total,
      dead_ends_shown: deadEndResult.filtered.length,
      dead_ends_omitted: deadEndResult.omitted,
      waf_blocked_total: wafResult.total,
      waf_blocked_shown: wafResult.filtered.length,
      waf_blocked_omitted: wafResult.omitted,
    },
    coverage_summary: coverageSummary,
    ranking_summary: surfaceObj.ranking || null,
    ...profileExtras,
  }, null, 2);
}

// Profile dispatch table. Adding a non-web, non-smart-contract pack means
// adding both a pack record (capability-packs.js) and an entry here — fail
// loudly on any profile we did not explicitly opt in.
function buildBriefExtrasForProfile(profile, { domain, surface, assignment }) {
  if (profile === "web") {
    return buildWebBriefExtras(domain, surface);
  }
  if (typeof profile === "string" && profile.startsWith("smart_contract_")) {
    return buildSmartContractBriefExtras(domain, surface, assignment);
  }
  throw new Error(`Unsupported brief profile: ${profile}`);
}

// Web profile carries HTTP-flavored intel: bypass tables for the surface's
// tech stack, web technique/payload knowledge, traffic + audit + circuit
// breaker summaries from real HTTP probes, public bounty intel, static scan
// hints, and an auth-profile hint pointing the hunter at bounty_list_auth_profiles.
function buildWebBriefExtras(domain, surfaceObj) {
  const bypassFile = resolveBypassTable(surfaceObj.tech_stack);
  let bypassTable = "";
  try {
    const content = readResourceText("bypass-tables", bypassFile);
    if (content != null) bypassTable = content.trim();
  } catch {}
  const knowledge = resolveHunterKnowledge(surfaceObj);
  const trafficSummary = summarizeTrafficRecords(
    readTrafficRecordsFromJsonl(domain),
    { surface: surfaceObj },
  );
  const auditRecords = readHttpAuditRecordsFromJsonl(domain);
  const auditSummary = summarizeHttpAuditRecords(auditRecords, { surface: surfaceObj, targetDomain: domain });
  const circuitBreakerSummary = buildCircuitBreakerSummary(auditRecords, { surface: surfaceObj });
  const intelHints = summarizePublicIntelForSurface(domain, surfaceObj);
  const staticScanHints = summarizeStaticScanHints(domain, { surface: surfaceObj });
  return {
    bypass_table: bypassTable || null,
    techniques: knowledge.techniques,
    payload_hints: knowledge.payload_hints,
    knowledge_summary: knowledge.knowledge_summary,
    traffic_summary: trafficSummary,
    audit_summary: auditSummary,
    circuit_breaker_summary: circuitBreakerSummary,
    intel_hints: intelHints,
    static_scan_hints: staticScanHints,
    auth_profiles_hint: "Call `bounty_list_auth_profiles`; pass the chosen profile name as `auth_profile` to `bounty_http_scan`.",
  };
}

// Smart-contract profile carries on-chain context: the bob-spec status with
// trust assumptions and bypass conditions filtered to this surface, and the
// public RPC pool for the surface's chain_family/chain_id. Web-flavored
// fields (bypass_table, traffic, audit, intel, payload hints, auth profiles)
// are intentionally omitted; SC hunters do not have the tools that consume them.
function buildSmartContractBriefExtras(domain, surfaceObj, assignment) {
  return {
    bob_spec_status: summarizeBobSpecForBrief(loadBobSpec(domain), assignment.surface_id),
    rpc_pool: summarizeRpcPoolForBrief(surfaceObj.chain_family, surfaceObj.chain_id),
  };
}

module.exports = {
  BOB_SPEC_ABSENT_MESSAGE,
  readHunterBrief,
  hunterKnowledgeCandidatePaths,
  resolveBypassTable,
  resolveHunterKnowledge,
  slimSurfaceForBrief,
};
