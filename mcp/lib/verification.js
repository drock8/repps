"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  SEVERITY_VALUES,
  VERIFICATION_REPLAY_PURPOSE_VALUES,
  VERIFICATION_ROUND_VALUES,
  VERIFY_QA_SAMPLE_MAX,
  VERIFY_SMALL_REPORTABLE_THRESHOLD,
} = require("./constants.js");
const {
  assertEnumValue,
  assertNonEmptyString,
  parseFindingId,
} = require("./validation.js");
const {
  evidencePackPaths,
  verificationAdjudicationPath,
  verificationAttemptsDir,
  verificationManifestPath,
  verificationRoundPaths,
  verificationSnapshotPath,
} = require("./paths.js");
const {
  loadJsonDocumentStrict,
  writeFileAtomic,
} = require("./storage.js");
const {
  ERROR_CODES,
  ToolError,
} = require("./envelope.js");
const {
  CAPABILITY_PACKS,
} = require("./capability-packs.js");
const {
  listAuthProfiles,
} = require("./auth.js");
const {
  readChainAttemptsFromJsonl,
} = require("./chain-attempts.js");
const {
  readSurfaceRoutesStrict,
} = require("./surface-router.js");

const VERIFICATION_SCHEMA_V1 = 1;
const VERIFICATION_SCHEMA_V2 = 2;
const VERIFICATION_INPUT_CHANGED_MESSAGE = "VERIFY input changed after snapshot; restart VERIFY/adjudication.";
const VERIFICATION_ARCHIVE_RETENTION = 5;
const DEFAULT_REPLAY_SAFETY = Object.freeze({
  mode: "serialized",
  lease_scope: "attempt_pack",
});

const ACTIVE_REPLAY_LEASES = new Map();

function findingsLib() {
  return require("./findings.js");
}

function sessionStateLib() {
  return require("./session-state.js");
}

function evidenceLib() {
  return require("./evidence.js");
}

function pipelineAnalyticsLib() {
  return require("./pipeline-analytics.js");
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (isPlainObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hashCanonicalJson(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readStateSafe(domain) {
  try {
    return sessionStateLib().readSessionStateStrict(domain).state;
  } catch {
    return null;
  }
}

function safeAppendPipelineEvent(domain, type, fields) {
  try {
    pipelineAnalyticsLib().safeAppendPipelineEventDirect(domain, type, fields);
  } catch {}
}

function verificationSourceFiles(domain) {
  const files = [
    ["verification-input-snapshot.json", verificationSnapshotPath(domain)],
    ["verification-adjudication.json", verificationAdjudicationPath(domain)],
    ["verification-manifest.json", verificationManifestPath(domain)],
  ];
  for (const round of VERIFICATION_ROUND_VALUES) {
    const paths = verificationRoundPaths(domain, round);
    files.push([path.basename(paths.json), paths.json]);
    files.push([path.basename(paths.markdown), paths.markdown]);
  }
  const evidence = evidencePackPaths(domain);
  files.push([path.basename(evidence.json), evidence.json]);
  files.push([path.basename(evidence.markdown), evidence.markdown]);
  return files;
}

function hasV1VerificationArtifacts(domain) {
  for (const round of VERIFICATION_ROUND_VALUES) {
    const paths = verificationRoundPaths(domain, round);
    if (!fs.existsSync(paths.json)) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(paths.json, "utf8"));
      if (!isPlainObject(doc)) return true;
      if (doc.version === VERIFICATION_SCHEMA_V1 && doc.verification_attempt_id == null) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function hasCurrentV2Files(domain) {
  if (fs.existsSync(verificationSnapshotPath(domain))) return true;
  if (fs.existsSync(verificationAdjudicationPath(domain))) return true;
  if (fs.existsSync(verificationManifestPath(domain))) return true;
  const evidence = safeReadJson(evidencePackPaths(domain).json);
  if (evidence && evidence.verification_attempt_id) return true;
  for (const round of VERIFICATION_ROUND_VALUES) {
    const doc = safeReadJson(verificationRoundPaths(domain, round).json);
    if (doc && (doc.version === VERIFICATION_SCHEMA_V2 || doc.verification_attempt_id)) return true;
  }
  return false;
}

function selectVerificationWriteSchemaVersion(domain) {
  const state = readStateSafe(domain);
  if (state && state.verification_schema_version === VERIFICATION_SCHEMA_V1) return VERIFICATION_SCHEMA_V1;
  if (hasV1VerificationArtifacts(domain)) return VERIFICATION_SCHEMA_V1;
  if (state && state.verification_schema_version === VERIFICATION_SCHEMA_V2) return VERIFICATION_SCHEMA_V2;
  if (fs.existsSync(verificationSnapshotPath(domain))) return VERIFICATION_SCHEMA_V2;
  return VERIFICATION_SCHEMA_V1;
}

function schemaVersionForContext(domain) {
  const state = readStateSafe(domain);
  if (state && state.verification_schema_version === VERIFICATION_SCHEMA_V1) return VERIFICATION_SCHEMA_V1;
  if (hasV1VerificationArtifacts(domain)) return VERIFICATION_SCHEMA_V1;
  return VERIFICATION_SCHEMA_V2;
}

function parseListAuthProfiles(domain) {
  try {
    const parsed = JSON.parse(listAuthProfiles({ target_domain: domain }));
    return Array.isArray(parsed.profiles) ? parsed.profiles : [];
  } catch (error) {
    return [{ error: error.message || String(error) }];
  }
}

function readSurfaceRoutesSnapshot(domain) {
  try {
    return readSurfaceRoutesStrict(domain).document;
  } catch (error) {
    return { error: error.message || String(error) };
  }
}

function buildSnapshotPayload(domain, { attemptId, createdAt }) {
  const findings = findingsLib().readFindingsFromJsonl(domain).slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const chainAttempts = readChainAttemptsFromJsonl(domain).slice()
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  const authProfiles = parseListAuthProfiles(domain).slice()
    .sort((a, b) => String(a.profile_name || "").localeCompare(String(b.profile_name || "")));
  const surfaceRoutes = readSurfaceRoutesSnapshot(domain);
  const findingIds = findings.map((finding) => finding.id);
  return {
    version: 1,
    schema_version: VERIFICATION_SCHEMA_V2,
    target_domain: domain,
    verification_attempt_id: attemptId,
    created_at: createdAt,
    finding_ids: findingIds,
    input_hashes: {
      findings: hashCanonicalJson(findings),
      chain_attempts: hashCanonicalJson(chainAttempts),
      auth_profile_summaries: hashCanonicalJson(authProfiles),
      surface_routes: hashCanonicalJson(surfaceRoutes),
    },
  };
}

function buildVerificationSnapshot(domain, { attemptId, createdAt }) {
  const payload = buildSnapshotPayload(domain, { attemptId, createdAt });
  return {
    ...payload,
    snapshot_hash: hashCanonicalJson(payload),
  };
}

function recomputeSnapshotHash(domain, snapshot) {
  const payload = buildSnapshotPayload(domain, {
    attemptId: snapshot.verification_attempt_id,
    createdAt: snapshot.created_at,
  });
  return hashCanonicalJson(payload);
}

function loadCurrentSnapshot(domain, state) {
  const snapshot = loadJsonDocumentStrict(verificationSnapshotPath(domain), "verification input snapshot JSON");
  if (snapshot.verification_attempt_id !== state.verification_attempt_id) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "Current VERIFY v2 snapshot attempt mismatch; restart VERIFY/adjudication.");
  }
  if (snapshot.snapshot_hash !== state.verification_snapshot_hash) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "Current VERIFY v2 snapshot hash mismatch; restart VERIFY/adjudication.");
  }
  return snapshot;
}

function assertFreshVerificationSnapshot(domain, state) {
  if (!state || state.verification_schema_version !== VERIFICATION_SCHEMA_V2) return null;
  const snapshot = loadCurrentSnapshot(domain, state);
  const currentHash = recomputeSnapshotHash(domain, snapshot);
  if (currentHash !== state.verification_snapshot_hash) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, VERIFICATION_INPUT_CHANGED_MESSAGE);
  }
  return snapshot;
}

function verificationAttemptId(now = new Date()) {
  const stamp = now.toISOString().replace(/[^0-9A-Za-z]+/g, "").replace(/Z$/, "");
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${stamp}-${suffix}`;
}

function sanitizeAttemptId(attemptId) {
  return String(attemptId || "unknown").replace(/[^A-Za-z0-9._-]+/g, "_");
}

function readArchiveManifest(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function listArchivedVerificationAttempts(domain) {
  const dir = verificationAttemptsDir(domain);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^attempt-/.test(entry.name))
    .map((entry) => {
      const attemptDir = path.join(dir, entry.name);
      const manifestPath = path.join(attemptDir, "manifest.json");
      const manifest = readArchiveManifest(manifestPath);
      return {
        attempt_id: manifest && manifest.attempt_id ? manifest.attempt_id : entry.name.replace(/^attempt-/, ""),
        archive_dir: attemptDir,
        manifest_path: fs.existsSync(manifestPath) ? manifestPath : null,
        archived_at: manifest && manifest.archived_at ? manifest.archived_at : null,
        snapshot_hash: manifest && manifest.snapshot_hash ? manifest.snapshot_hash : null,
        files_count: manifest && manifest.files ? Object.keys(manifest.files).length : 0,
        missing_files_count: manifest && Array.isArray(manifest.missing_files) ? manifest.missing_files.length : 0,
      };
    })
    .sort((a, b) => String(b.archived_at || "").localeCompare(String(a.archived_at || "")) || a.attempt_id.localeCompare(b.attempt_id));
}

function pruneOldVerificationArchives(domain) {
  const dir = verificationAttemptsDir(domain);
  const archives = listArchivedVerificationAttempts(domain);
  const pruned = [];
  for (const archive of archives.slice(VERIFICATION_ARCHIVE_RETENTION)) {
    try {
      fs.rmSync(archive.archive_dir, { recursive: true, force: true });
      pruned.push(archive.attempt_id);
    } catch {}
  }
  if (pruned.length > 0) {
    safeAppendPipelineEvent(domain, "verification_archive_pruned", {
      phase: "VERIFY",
      status: "pruned",
      source: "verification_v2",
      counts: { pruned: pruned.length },
    });
  }
  if (fs.existsSync(dir)) return pruned;
  return pruned;
}

function archiveCurrentV2Attempt(domain, { attemptId, snapshotHash }) {
  if (!attemptId && !hasCurrentV2Files(domain)) return null;
  const archivedAt = new Date().toISOString();
  const archiveDir = path.join(verificationAttemptsDir(domain), `attempt-${sanitizeAttemptId(attemptId || "unknown")}`);
  if (fs.existsSync(archiveDir)) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, `Cannot archive current verification attempt because archive already exists: ${archiveDir}`);
  }

  const files = {};
  const missingFiles = [];
  let planHash = null;
  let finalVerificationHash = null;
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const [name, filePath] of verificationSourceFiles(domain)) {
      if (!fs.existsSync(filePath)) {
        missingFiles.push(name);
        continue;
      }
      const targetPath = path.join(archiveDir, name);
      fs.copyFileSync(filePath, targetPath);
      files[name] = hashFile(targetPath);
      if (name === "verification-adjudication.json") {
        const doc = safeReadJson(targetPath);
        if (doc && typeof doc.plan_hash === "string") planHash = doc.plan_hash;
      }
      if (name === "verified-final.json") {
        const doc = safeReadJson(targetPath);
        if (doc && typeof doc.final_verification_hash === "string") {
          finalVerificationHash = doc.final_verification_hash;
        }
      }
    }

    const manifest = {
      attempt_id: attemptId || "unknown",
      archived_at: archivedAt,
      snapshot_hash: snapshotHash || null,
      ...(planHash ? { plan_hash: planHash } : {}),
      ...(finalVerificationHash ? { final_verification_hash: finalVerificationHash } : {}),
      files,
      missing_files: missingFiles,
    };
    writeFileAtomic(path.join(archiveDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    safeAppendPipelineEvent(domain, "verification_attempt_archived", {
      phase: "VERIFY",
      status: "archived",
      source: "verification_v2",
      verification_attempt_id: attemptId || "unknown",
      verification_snapshot_hash: snapshotHash || undefined,
      plan_hash: planHash || undefined,
      final_verification_hash: finalVerificationHash || undefined,
      counts: {
        files: Object.keys(files).length,
        missing_files: missingFiles.length,
      },
    });
    pruneOldVerificationArchives(domain);
    return manifest;
  } catch (error) {
    try { fs.rmSync(archiveDir, { recursive: true, force: true }); } catch {}
    throw new ToolError(
      ERROR_CODES.STATE_CONFLICT,
      `Failed to archive current verification attempt before starting a new one: ${error.message || String(error)}`,
    );
  }
}

function prepareVerificationEntry(domain, state, { now = new Date() } = {}) {
  if ((state && state.verification_schema_version === VERIFICATION_SCHEMA_V1) || hasV1VerificationArtifacts(domain)) {
    return {
      schema_version: VERIFICATION_SCHEMA_V1,
      state_fields: {
        verification_schema_version: VERIFICATION_SCHEMA_V1,
        verification_attempt_id: null,
        verification_snapshot_hash: null,
        verification_entered_at: null,
      },
      snapshot: null,
      archived: null,
    };
  }

  const previousAttemptId = state && state.verification_schema_version === VERIFICATION_SCHEMA_V2
    ? state.verification_attempt_id
    : null;
  const archived = archiveCurrentV2Attempt(domain, {
    attemptId: previousAttemptId,
    snapshotHash: state ? state.verification_snapshot_hash : null,
  });

  const enteredAt = now.toISOString();
  const attemptId = verificationAttemptId(now);
  const snapshot = buildVerificationSnapshot(domain, { attemptId, createdAt: enteredAt });
  writeFileAtomic(verificationSnapshotPath(domain), `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileAtomic(verificationManifestPath(domain), `${JSON.stringify({
    version: 1,
    schema_version: VERIFICATION_SCHEMA_V2,
    target_domain: domain,
    attempt_id: attemptId,
    snapshot_hash: snapshot.snapshot_hash,
    entered_at: enteredAt,
  }, null, 2)}\n`);
  safeAppendPipelineEvent(domain, "verification_snapshot_created", {
    phase: "VERIFY",
    status: "created",
    source: "bounty_transition_phase",
    verification_attempt_id: attemptId,
    verification_snapshot_hash: snapshot.snapshot_hash,
    counts: {
      findings: snapshot.finding_ids.length,
    },
  });

  return {
    schema_version: VERIFICATION_SCHEMA_V2,
    state_fields: {
      verification_schema_version: VERIFICATION_SCHEMA_V2,
      verification_attempt_id: attemptId,
      verification_snapshot_hash: snapshot.snapshot_hash,
      verification_entered_at: enteredAt,
    },
    snapshot,
    archived,
  };
}

function requireV2State(domain) {
  const state = readStateSafe(domain);
  if (!state || state.verification_schema_version !== VERIFICATION_SCHEMA_V2) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "VERIFY v2 attempt is not active for this session.");
  }
  if (!state.verification_attempt_id || !state.verification_snapshot_hash) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "VERIFY v2 attempt metadata is missing; transition into VERIFY again.");
  }
  const snapshot = assertFreshVerificationSnapshot(domain, state);
  return { state, snapshot };
}

function validateCurrentAttemptArgs(args, state) {
  if (args.verification_attempt_id == null || args.verification_snapshot_hash == null) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENTS, "verification_attempt_id and verification_snapshot_hash are required for v2 verification writes");
  }
  if (args.verification_attempt_id !== state.verification_attempt_id) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "verification_attempt_id does not match the current VERIFY attempt");
  }
  if (args.verification_snapshot_hash !== state.verification_snapshot_hash) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "verification_snapshot_hash does not match the current VERIFY snapshot");
  }
}

function assertExactFindingCoverage(results, findingIds, label) {
  const expected = new Set(findingIds);
  const actual = new Set(results.map((result) => result.finding_id));
  const missing = findingIds.filter((id) => !actual.has(id));
  const extra = [...actual].filter((id) => !expected.has(id)).sort((a, b) => a.localeCompare(b));
  if (missing.length > 0 || extra.length > 0) {
    const details = [];
    if (missing.length > 0) details.push(`missing: ${missing.join(", ")}`);
    if (extra.length > 0) details.push(`extra: ${extra.join(", ")}`);
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, `${label} must cover exactly the current VERIFY snapshot finding IDs (${details.join("; ")})`);
  }
}

function currentV2RoundInput(domain, args) {
  const { state, snapshot } = requireV2State(domain);
  validateCurrentAttemptArgs(args, state);
  return { state, snapshot };
}

function documentHashExcluding(document, fields) {
  const clone = cloneJson(document);
  for (const field of fields) delete clone[field];
  return hashCanonicalJson(clone);
}

function finalVerificationHash(document) {
  return documentHashExcluding(document, ["final_verification_hash"]);
}

function assertCurrentV2RoundDocument(domain, document, { expectedRound = null, state = null, snapshot = null } = {}) {
  if (!isPlainObject(document) || document.version !== VERIFICATION_SCHEMA_V2) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "Expected a v2 verification round artifact.");
  }
  const effectiveState = state || readStateSafe(domain);
  if (!effectiveState || effectiveState.verification_schema_version !== VERIFICATION_SCHEMA_V2) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "No current v2 verification attempt is active.");
  }
  const effectiveSnapshot = snapshot || assertFreshVerificationSnapshot(domain, effectiveState);
  if (expectedRound && document.round !== expectedRound) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, `Expected ${expectedRound} verification round artifact.`);
  }
  if (document.verification_attempt_id !== effectiveState.verification_attempt_id) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, `${document.round || "verification"} artifact is stale: attempt mismatch`);
  }
  if (document.verification_snapshot_hash !== effectiveState.verification_snapshot_hash) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, `${document.round || "verification"} artifact is stale: snapshot mismatch`);
  }
  assertExactFindingCoverage(document.results || [], effectiveSnapshot.finding_ids, `${document.round || "verification"} round`);
  if (document.round === "final") {
    if (!document.final_verification_hash) {
      throw new ToolError(ERROR_CODES.STATE_CONFLICT, "final verification artifact is missing final_verification_hash");
    }
    const recomputed = finalVerificationHash(document);
    if (document.final_verification_hash !== recomputed) {
      throw new ToolError(ERROR_CODES.STATE_CONFLICT, "final verification hash mismatch");
    }
  }
  return { state: effectiveState, snapshot: effectiveSnapshot };
}

function loadCurrentV2Round(domain, round, { state = null, snapshot = null } = {}) {
  const document = loadJsonDocumentStrict(verificationRoundPaths(domain, round).json, `${round} verification round JSON`);
  const { normalizeVerificationRoundDocument } = findingsLib();
  const findingIdSet = new Set((snapshot ? snapshot.finding_ids : findingsLib().readFindingsFromJsonl(domain).map((finding) => finding.id)));
  const normalized = normalizeVerificationRoundDocument(document, {
    expectedDomain: domain,
    expectedRound: round,
    findingIdSet,
  });
  assertCurrentV2RoundDocument(domain, normalized, { expectedRound: round, state, snapshot });
  return normalized;
}

function resultSummary(result) {
  return {
    disposition: result.disposition,
    severity: result.severity,
    reportable: result.reportable === true,
    confidence: result.confidence || null,
    confidence_reasons: Array.isArray(result.confidence_reasons) ? result.confidence_reasons.slice().sort() : [],
    state_sensitive: result.state_sensitive === true,
  };
}

function findingDiffs(a, b) {
  const diffs = [];
  for (const field of ["disposition", "severity", "reportable"]) {
    if (!Object.is(a[field], b[field])) diffs.push(field);
  }
  return diffs;
}

function isHighOrCritical(severity) {
  return ["critical", "high"].includes(severity);
}

function replayReasonForResult(result) {
  const reasons = Array.isArray(result.confidence_reasons) ? result.confidence_reasons : [];
  if (result.confidence === "low" || result.confidence === "medium") return "low_confidence";
  if (reasons.includes("auth_expired")) return "auth";
  if (reasons.includes("tooling_blocked")) return "tooling";
  if (reasons.includes("disambiguation_failed")) return "disambiguation";
  if (reasons.includes("roast_disagreement")) return "roast";
  if (reasons.includes("manual_inference")) return "manual_inference";
  if (reasons.includes("state_changed")) return "state_changed";
  return null;
}

function deterministicQaSample(targetDomain, state, snapshot, candidates) {
  return candidates
    .map((findingId) => ({
      finding_id: findingId,
      hash: crypto.createHash("sha256")
        .update(`${targetDomain}:${state.verification_attempt_id}:${snapshot.snapshot_hash}:${findingId}`)
        .digest("hex"),
    }))
    .sort((a, b) => a.hash.localeCompare(b.hash) || a.finding_id.localeCompare(b.finding_id))
    .slice(0, VERIFY_QA_SAMPLE_MAX)
    .map((entry) => entry.finding_id);
}

function adjudicationHashPayload(document) {
  const clone = cloneJson(document);
  delete clone.plan_hash;
  delete clone.built_at;
  return clone;
}

function computeAdjudicationPlanHash(document) {
  return hashCanonicalJson(adjudicationHashPayload(document));
}

function buildVerificationAdjudication(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  const { state, snapshot } = requireV2State(domain);
  const brutalist = loadCurrentV2Round(domain, "brutalist", { state, snapshot });
  const balanced = loadCurrentV2Round(domain, "balanced", { state, snapshot });
  const brutalistById = new Map(brutalist.results.map((result) => [result.finding_id, result]));
  const balancedById = new Map(balanced.results.map((result) => [result.finding_id, result]));
  const agreed = [];
  const disagreements = [];
  const dispositionDiffs = [];
  const severityDiffs = [];
  const reportableDiffs = [];
  const replayRequired = new Set();
  const replayReasons = {};
  const unionReportables = new Set();

  const addReplay = (findingId, reason) => {
    replayRequired.add(findingId);
    if (!replayReasons[findingId]) replayReasons[findingId] = [];
    if (reason && !replayReasons[findingId].includes(reason)) replayReasons[findingId].push(reason);
  };

  for (const findingId of snapshot.finding_ids) {
    const b = resultSummary(brutalistById.get(findingId));
    const c = resultSummary(balancedById.get(findingId));
    if (b.reportable || c.reportable) unionReportables.add(findingId);
    const diffs = findingDiffs(b, c);
    if (diffs.length === 0) {
      agreed.push({ finding_id: findingId, ...b });
    } else {
      disagreements.push({
        finding_id: findingId,
        diffs,
        brutalist: b,
        balanced: c,
      });
      addReplay(findingId, "round_disagreement");
      if (diffs.includes("disposition")) dispositionDiffs.push(findingId);
      if (diffs.includes("severity")) severityDiffs.push(findingId);
      if (diffs.includes("reportable")) reportableDiffs.push(findingId);
    }
    if ((b.reportable || c.reportable) && (isHighOrCritical(b.severity) || isHighOrCritical(c.severity))) {
      addReplay(findingId, "agreed_high_or_critical_reportable");
    }
    if (b.state_sensitive || c.state_sensitive) {
      addReplay(findingId, "state_sensitive");
    }
    for (const result of [brutalistById.get(findingId), balancedById.get(findingId)]) {
      const reason = replayReasonForResult(result || {});
      if (reason) addReplay(findingId, reason);
    }
  }

  if (unionReportables.size <= VERIFY_SMALL_REPORTABLE_THRESHOLD) {
    for (const findingId of unionReportables) addReplay(findingId, "small_reportable_union");
  }

  const qaCandidates = agreed
    .filter((entry) => entry.reportable && !replayRequired.has(entry.finding_id))
    .map((entry) => entry.finding_id);
  const qaSampledIds = deterministicQaSample(domain, state, snapshot, qaCandidates);
  for (const findingId of qaSampledIds) addReplay(findingId, "qa_sample");

  const payload = {
    version: 1,
    schema_version: VERIFICATION_SCHEMA_V2,
    target_domain: domain,
    verification_attempt_id: state.verification_attempt_id,
    verification_snapshot_hash: state.verification_snapshot_hash,
    input_round_hashes: {
      brutalist: hashCanonicalJson(brutalist),
      balanced: hashCanonicalJson(balanced),
    },
    finding_ids: snapshot.finding_ids.slice(),
    agreed,
    disagreements,
    missing_ids: {
      brutalist: snapshot.finding_ids.filter((id) => !brutalistById.has(id)),
      balanced: snapshot.finding_ids.filter((id) => !balancedById.has(id)),
    },
    disposition_diffs: dispositionDiffs,
    severity_diffs: severityDiffs,
    reportable_diffs: reportableDiffs,
    replay_required_ids: Array.from(replayRequired).sort((a, b) => a.localeCompare(b)),
    replay_reasons: Object.fromEntries(Object.entries(replayReasons).sort(([a], [b]) => a.localeCompare(b)).map(([id, reasons]) => [id, reasons.sort()])),
    replay_skipped_ids: Array.from(unionReportables).filter((id) => !replayRequired.has(id)).sort((a, b) => a.localeCompare(b)),
    qa_sampled_ids: qaSampledIds,
    qa_policy: {
      small_reportable_threshold: VERIFY_SMALL_REPORTABLE_THRESHOLD,
      qa_sample_max: VERIFY_QA_SAMPLE_MAX,
      deterministic_seed_fields: ["target_domain", "verification_attempt_id", "verification_snapshot_hash", "finding_id"],
    },
    counts: {
      findings: snapshot.finding_ids.length,
      agreed: agreed.length,
      disagreements: disagreements.length,
      union_reportables: unionReportables.size,
      replay_required: replayRequired.size,
      qa_sampled: qaSampledIds.length,
    },
  };
  const planHash = computeAdjudicationPlanHash(payload);
  const document = {
    ...payload,
    built_at: new Date().toISOString(),
    plan_hash: planHash,
  };
  writeFileAtomic(verificationAdjudicationPath(domain), `${JSON.stringify(document, null, 2)}\n`);
  safeAppendPipelineEvent(domain, "verification_adjudication_built", {
    phase: "VERIFY",
    status: "built",
    source: "bounty_build_verification_adjudication",
    verification_attempt_id: state.verification_attempt_id,
    verification_snapshot_hash: state.verification_snapshot_hash,
    plan_hash: planHash,
    counts: {
      agreed: agreed.length,
      disagreements: disagreements.length,
      replay_required: replayRequired.size,
      qa_sampled: qaSampledIds.length,
    },
  });
  return JSON.stringify({
    version: 1,
    target_domain: domain,
    verification_attempt_id: state.verification_attempt_id,
    verification_snapshot_hash: state.verification_snapshot_hash,
    plan_hash: planHash,
    counts: document.counts,
    written_json: verificationAdjudicationPath(domain),
  });
}

function requireCurrentAdjudication(domain, { planHash = null, state = null, snapshot = null } = {}) {
  const effective = state && snapshot ? { state, snapshot } : requireV2State(domain);
  const document = loadJsonDocumentStrict(verificationAdjudicationPath(domain), "verification adjudication JSON");
  if (document.version !== 1 || document.schema_version !== VERIFICATION_SCHEMA_V2) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "verification adjudication artifact is not v2");
  }
  if (document.verification_attempt_id !== effective.state.verification_attempt_id) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "verification adjudication is stale: attempt mismatch");
  }
  if (document.verification_snapshot_hash !== effective.state.verification_snapshot_hash) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "verification adjudication is stale: snapshot mismatch");
  }
  const recomputed = computeAdjudicationPlanHash(document);
  if (document.plan_hash !== recomputed) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "verification adjudication plan_hash mismatch");
  }
  if (planHash != null && planHash !== document.plan_hash) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "final verification plan_hash does not match the current adjudication plan");
  }
  return document;
}

function validateFinalAgainstAdjudication(domain, finalDocument, adjudication) {
  const trueStateSensitiveIds = new Set();
  for (const round of ["brutalist", "balanced"]) {
    const doc = loadCurrentV2Round(domain, round);
    for (const result of doc.results) {
      if (result.state_sensitive === true) trueStateSensitiveIds.add(result.finding_id);
    }
  }
  for (const result of finalDocument.results) {
    if (trueStateSensitiveIds.has(result.finding_id) && result.state_sensitive !== true) {
      throw new ToolError(ERROR_CODES.STATE_CONFLICT, `final verification cannot downgrade state_sensitive=false for ${result.finding_id}`);
    }
  }
  if (finalDocument.adjudication_plan_hash !== adjudication.plan_hash) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "final verification must reference the current adjudication plan_hash");
  }
}

function decorateVerificationRoundRead(domain, document) {
  if (!document || document.version !== VERIFICATION_SCHEMA_V2) return document;
  const result = {
    ...document,
    artifact_hash: hashCanonicalJson(document),
    current: false,
    stale: true,
    blocker_reason: null,
  };
  const state = readStateSafe(domain);
  if (!state || state.verification_schema_version !== VERIFICATION_SCHEMA_V2) {
    result.blocker_reason = "no current v2 verification attempt is active";
    return result;
  }
  if (document.verification_attempt_id !== state.verification_attempt_id) {
    result.blocker_reason = "attempt mismatch";
    return result;
  }
  if (document.verification_snapshot_hash !== state.verification_snapshot_hash) {
    result.blocker_reason = "snapshot mismatch";
    return result;
  }
  try {
    assertFreshVerificationSnapshot(domain, state);
  } catch (error) {
    result.blocker_reason = error.message || String(error);
    return result;
  }
  result.current = true;
  result.stale = false;
  result.blocker_reason = null;
  return result;
}

function evidenceBindingForFinal(domain, finalDocument) {
  if (!finalDocument || finalDocument.version !== VERIFICATION_SCHEMA_V2) return null;
  assertCurrentV2RoundDocument(domain, finalDocument, { expectedRound: "final" });
  return {
    verification_attempt_id: finalDocument.verification_attempt_id,
    verification_snapshot_hash: finalDocument.verification_snapshot_hash,
    final_verification_hash: finalDocument.final_verification_hash,
  };
}

function assertEvidenceMatchesFinal(domain, evidenceDocument, finalDocument) {
  const binding = evidenceBindingForFinal(domain, finalDocument);
  if (!binding) return null;
  for (const [field, expected] of Object.entries(binding)) {
    if (evidenceDocument[field] !== expected) {
      throw new ToolError(ERROR_CODES.STATE_CONFLICT, `evidence packs are stale: ${field} does not match current final verification`);
    }
  }
  return binding;
}

function replaySafetyForTool(toolName) {
  for (const pack of Object.values(CAPABILITY_PACKS)) {
    if (!pack || !pack.verifier) continue;
    if (pack.verifier.replay_tool === toolName || (pack.evidence && pack.evidence.runner === toolName)) {
      return {
        capability_pack: pack.id,
        replay_safety: pack.verifier.replay_safety || DEFAULT_REPLAY_SAFETY,
      };
    }
  }
  return null;
}

function normalizeReplayContext(ctx) {
  if (!isPlainObject(ctx)) return null;
  const purpose = typeof ctx.purpose === "string" ? ctx.purpose.trim() : "";
  if (!VERIFICATION_REPLAY_PURPOSE_VALUES.includes(purpose)) {
    return { purpose, active: false };
  }
  try {
    return {
      active: true,
      purpose,
      verification_attempt_id: assertNonEmptyString(ctx.verification_attempt_id, "replay_context.verification_attempt_id"),
      verification_snapshot_hash: assertNonEmptyString(ctx.verification_snapshot_hash, "replay_context.verification_snapshot_hash"),
      round: ctx.round == null ? null : assertEnumValue(ctx.round, VERIFICATION_ROUND_VALUES, "replay_context.round"),
      finding_id: ctx.finding_id == null ? null : parseFindingId(ctx.finding_id, "replay_context.finding_id"),
    };
  } catch (error) {
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENTS, error.message || String(error));
  }
}

function replayLeaseKey({ targetDomain, capabilityPack, context, leaseScope }) {
  if (leaseScope === "none") return null;
  if (leaseScope === "attempt_pack") {
    return `${targetDomain}:${context.verification_attempt_id}:${capabilityPack}`;
  }
  if (leaseScope === "finding") {
    if (!context.finding_id) {
      throw new ToolError(ERROR_CODES.INVALID_ARGUMENTS, "replay_context.finding_id is required for finding-scoped replay leases");
    }
    return `${targetDomain}:${context.verification_attempt_id}:${context.finding_id}`;
  }
  throw new ToolError(ERROR_CODES.INTERNAL_ERROR, `Unsupported replay lease_scope: ${leaseScope}`);
}

function assertReplayContextCurrent(targetDomain, context) {
  const { state } = requireV2State(targetDomain);
  if (context.verification_attempt_id !== state.verification_attempt_id) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "replay_context verification_attempt_id does not match current VERIFY attempt");
  }
  if (context.verification_snapshot_hash !== state.verification_snapshot_hash) {
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, "replay_context verification_snapshot_hash does not match current VERIFY snapshot");
  }
}

async function runWithReplaySafety(tool, args, handler) {
  const context = normalizeReplayContext(args && args.replay_context);
  if (!context || !context.active) {
    return handler();
  }
  const targetDomain = assertNonEmptyString(args.target_domain, "target_domain");
  assertReplayContextCurrent(targetDomain, context);
  const policy = replaySafetyForTool(tool.name);
  if (!policy) return handler();
  const mode = policy.replay_safety.mode || DEFAULT_REPLAY_SAFETY.mode;
  const leaseScope = policy.replay_safety.lease_scope || DEFAULT_REPLAY_SAFETY.lease_scope;
  if (leaseScope === "none" && mode !== "parallel_safe") {
    throw new ToolError(ERROR_CODES.INTERNAL_ERROR, "replay lease_scope none is allowed only with mode parallel_safe");
  }
  const key = replayLeaseKey({
    targetDomain,
    capabilityPack: policy.capability_pack,
    context,
    leaseScope,
  });
  if (key && ACTIVE_REPLAY_LEASES.has(key)) {
    safeAppendPipelineEvent(targetDomain, "verification_replay_policy_applied", {
      phase: "VERIFY",
      status: "lease_rejected",
      source: tool.name,
      verification_attempt_id: context.verification_attempt_id,
      verification_snapshot_hash: context.verification_snapshot_hash,
      capability_pack: policy.capability_pack,
      lease_scope: leaseScope,
      replay_purpose: context.purpose,
      counts: { active_leases: ACTIVE_REPLAY_LEASES.size },
    });
    throw new ToolError(ERROR_CODES.STATE_CONFLICT, `Replay lease busy for ${leaseScope}: ${key}`);
  }
  if (key) {
    ACTIVE_REPLAY_LEASES.set(key, {
      tool: tool.name,
      capability_pack: policy.capability_pack,
      purpose: context.purpose,
      acquired_at: Date.now(),
    });
  }
  safeAppendPipelineEvent(targetDomain, "verification_replay_policy_applied", {
    phase: "VERIFY",
    status: key ? "lease_acquired" : "parallel_safe",
    source: tool.name,
    verification_attempt_id: context.verification_attempt_id,
    verification_snapshot_hash: context.verification_snapshot_hash,
    capability_pack: policy.capability_pack,
    lease_scope: leaseScope,
    replay_purpose: context.purpose,
    counts: { active_leases: ACTIVE_REPLAY_LEASES.size },
  });
  try {
    return await handler();
  } finally {
    if (key) ACTIVE_REPLAY_LEASES.delete(key);
  }
}

function replayExecutionPolicy() {
  return Object.values(CAPABILITY_PACKS).map((pack) => {
    const safety = pack.verifier.replay_safety || DEFAULT_REPLAY_SAFETY;
    const active = Array.from(ACTIVE_REPLAY_LEASES.entries())
      .filter(([, value]) => value.capability_pack === pack.id)
      .map(([key, value]) => ({ key, tool: value.tool, purpose: value.purpose }));
    return {
      capability_pack: pack.id,
      mode: safety.mode,
      lease_scope: safety.lease_scope,
      can_run_rounds_concurrently: safety.mode === "parallel_safe" || safety.lease_scope === "finding",
      active_leases: active,
      next_available_after_ms: active.length > 0 && safety.mode === "serialized" ? 1 : 0,
    };
  }).sort((a, b) => a.capability_pack.localeCompare(b.capability_pack));
}

function roundStatus(domain, round, state) {
  const paths = verificationRoundPaths(domain, round);
  const status = {
    round,
    exists: fs.existsSync(paths.json),
    current: false,
    stale: false,
    blocker_reason: null,
    results_count: 0,
    reportable_count: 0,
    artifact_hash: null,
  };
  if (!status.exists) return status;
  try {
    const doc = JSON.parse(fs.readFileSync(paths.json, "utf8"));
    status.artifact_hash = hashCanonicalJson(doc);
    status.results_count = Array.isArray(doc.results) ? doc.results.length : 0;
    status.reportable_count = Array.isArray(doc.results) ? doc.results.filter((result) => result && result.reportable === true).length : 0;
    if (doc.version !== VERIFICATION_SCHEMA_V2) {
      status.current = schemaVersionForContext(domain) === VERIFICATION_SCHEMA_V1;
      status.stale = !status.current;
      status.blocker_reason = status.stale ? "v1 artifact in v2 context" : null;
      return status;
    }
    const decorated = decorateVerificationRoundRead(domain, doc);
    status.current = decorated.current === true;
    status.stale = decorated.stale === true;
    status.blocker_reason = decorated.blocker_reason;
  } catch (error) {
    status.stale = true;
    status.blocker_reason = error.message || String(error);
  }
  return status;
}

function adjudicationStatus(domain, state) {
  const filePath = verificationAdjudicationPath(domain);
  const status = {
    exists: fs.existsSync(filePath),
    current: false,
    stale: false,
    blocker_reason: null,
    plan_hash: null,
  };
  if (!status.exists) return status;
  try {
    const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
    status.plan_hash = typeof doc.plan_hash === "string" ? doc.plan_hash : null;
    if (!state || state.verification_schema_version !== VERIFICATION_SCHEMA_V2) {
      status.stale = true;
      status.blocker_reason = "no current v2 verification attempt is active";
    } else if (doc.verification_attempt_id !== state.verification_attempt_id) {
      status.stale = true;
      status.blocker_reason = "attempt mismatch";
    } else if (doc.verification_snapshot_hash !== state.verification_snapshot_hash) {
      status.stale = true;
      status.blocker_reason = "snapshot mismatch";
    } else if (computeAdjudicationPlanHash(doc) !== doc.plan_hash) {
      status.stale = true;
      status.blocker_reason = "plan_hash mismatch";
    } else {
      status.current = true;
    }
  } catch (error) {
    status.stale = true;
    status.blocker_reason = error.message || String(error);
  }
  return status;
}

function evidenceMatchStatus(domain) {
  try {
    const validation = evidenceLib().requireValidEvidencePacksForFinalReportableFindings(domain);
    return {
      exists: validation.exists,
      valid: validation.valid,
      skipped: validation.skipped === true,
      matches_final: true,
      final_reportable_count: validation.final_reportable_count,
      packs_count: validation.packs_count,
      missing_finding_ids: [],
    };
  } catch (error) {
    return {
      exists: fs.existsSync(evidencePackPaths(domain).json),
      valid: false,
      skipped: false,
      matches_final: false,
      blocker_reason: error.message || String(error),
      missing_finding_ids: [],
    };
  }
}

function nextVerificationAction({ schemaVersion, state, rounds, adjudication, evidence, staleBlockers }) {
  if (schemaVersion === VERIFICATION_SCHEMA_V1) return "continue v1 sequential verification cascade";
  if (!state || !state.verification_attempt_id) return "transition CHAIN -> VERIFY to create v2 verification attempt";
  if (staleBlockers.length > 0) return "restart VERIFY/adjudication";
  if (!rounds.brutalist.current || !rounds.balanced.current) return "run independent brutalist and balanced verifier rounds";
  if (!adjudication.current) return "call bounty_build_verification_adjudication";
  if (!rounds.final.current) return "run final verifier with the current adjudication plan_hash";
  if (!evidence.valid) return "write or repair evidence packs for current final verification";
  return "transition VERIFY -> GRADE";
}

function readVerificationContext(args) {
  const domain = assertNonEmptyString(args.target_domain, "target_domain");
  const state = readStateSafe(domain);
  const schemaVersion = schemaVersionForContext(domain);
  let staleBlockers = [];
  let snapshotHashCurrent = false;
  if (state && state.verification_schema_version === VERIFICATION_SCHEMA_V2) {
    try {
      assertFreshVerificationSnapshot(domain, state);
      snapshotHashCurrent = true;
    } catch (error) {
      staleBlockers = [error.message || String(error)];
    }
  }
  const rounds = Object.fromEntries(VERIFICATION_ROUND_VALUES.map((round) => [round, roundStatus(domain, round, state)]));
  const adjudication = adjudicationStatus(domain, state);
  const evidence = evidenceMatchStatus(domain);
  const context = {
    version: 1,
    target_domain: domain,
    schema_version: schemaVersion,
    current_attempt_id: state ? state.verification_attempt_id : null,
    snapshot_hash: state ? state.verification_snapshot_hash : null,
    snapshot_hash_current: snapshotHashCurrent,
    entered_at: state ? state.verification_entered_at : null,
    round_status: rounds,
    adjudication_status: adjudication,
    evidence_match_status: evidence,
    stale_blockers: staleBlockers,
    replay_execution_policy: replayExecutionPolicy(),
    archived_attempts: listArchivedVerificationAttempts(domain),
  };
  context.next_action = nextVerificationAction({
    schemaVersion,
    state,
    rounds,
    adjudication,
    evidence,
    staleBlockers,
  });
  return JSON.stringify(context);
}

module.exports = {
  DEFAULT_REPLAY_SAFETY,
  VERIFICATION_ARCHIVE_RETENTION,
  VERIFICATION_INPUT_CHANGED_MESSAGE,
  VERIFICATION_SCHEMA_V1,
  VERIFICATION_SCHEMA_V2,
  assertCurrentV2RoundDocument,
  assertEvidenceMatchesFinal,
  assertExactFindingCoverage,
  assertFreshVerificationSnapshot,
  buildVerificationAdjudication,
  computeAdjudicationPlanHash,
  currentV2RoundInput,
  decorateVerificationRoundRead,
  evidenceBindingForFinal,
  finalVerificationHash,
  hashCanonicalJson,
  listArchivedVerificationAttempts,
  prepareVerificationEntry,
  readVerificationContext,
  requireCurrentAdjudication,
  requireV2State,
  runWithReplaySafety,
  selectVerificationWriteSchemaVersion,
  validateCurrentAttemptArgs,
  validateFinalAgainstAdjudication,
};
