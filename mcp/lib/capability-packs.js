"use strict";

const WEB_CAPABILITY_PACK = Object.freeze({
  id: "web",
  hunter_agent: "hunter-agent",
  brief_profile: "web",
  role_bundles: Object.freeze(["hunter-web"]),
  completion_gate: "web_wave_handoff",
});

const CAPABILITY_PACKS = Object.freeze({
  web: WEB_CAPABILITY_PACK,
});

const WEB_SURFACE_TYPES = Object.freeze([
  "admin",
  "api",
  "auth",
  "billing",
  "ci_cd",
  "cms",
  "graphql",
  "js_endpoint",
  "mobile_api",
  "secrets",
  "static",
  "unknown",
  "upload",
]);

const WEB_SURFACE_TYPE_SET = new Set(WEB_SURFACE_TYPES);

// Smart-contract packs are intentionally inactive on this branch. The
// platform-adapters merge must add smart_contract_evm, smart_contract_svm,
// smart_contract_move, smart_contract_substrate, and smart_contract_cosmwasm
// here before those hunters can be selected by routing.

function normalizeSurfaceType(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized || null;
}

function getCapabilityPack(packId) {
  return CAPABILITY_PACKS[packId] || null;
}

function defaultWebRouteMetadata() {
  return {
    capability_pack: WEB_CAPABILITY_PACK.id,
    hunter_agent: WEB_CAPABILITY_PACK.hunter_agent,
    brief_profile: WEB_CAPABILITY_PACK.brief_profile,
  };
}

function classifySurfaceCapability(surface) {
  const rawSurfaceType = surface && typeof surface === "object" ? surface.surface_type : null;
  const normalizedType = normalizeSurfaceType(rawSurfaceType);
  const surfaceType = normalizedType || "unknown";
  const reasons = normalizedType ? [`surface_type:${surfaceType}`] : ["surface_type:missing"];
  const knownWebType = normalizedType == null || WEB_SURFACE_TYPE_SET.has(surfaceType);

  if (!knownWebType) {
    reasons.push("fallback:web");
  }

  return {
    surface_type: surfaceType,
    capability_pack: WEB_CAPABILITY_PACK.id,
    hunter_agent: WEB_CAPABILITY_PACK.hunter_agent,
    brief_profile: WEB_CAPABILITY_PACK.brief_profile,
    confidence: knownWebType ? "high" : "medium",
    reasons,
  };
}

function assertPackString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`assignment route metadata has invalid ${fieldName}`);
  }
  const normalized = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error(`assignment route metadata has invalid ${fieldName}`);
  }
  return normalized;
}

function normalizeAssignmentRouteMetadata(assignment) {
  const hasRouteMetadata = !!assignment && (
    assignment.capability_pack != null ||
    assignment.hunter_agent != null ||
    assignment.brief_profile != null
  );
  if (!hasRouteMetadata) {
    return defaultWebRouteMetadata();
  }

  const capabilityPack = assertPackString(assignment.capability_pack, "capability_pack");
  const hunterAgent = assertPackString(assignment.hunter_agent, "hunter_agent");
  const briefProfile = assertPackString(assignment.brief_profile, "brief_profile");
  const pack = getCapabilityPack(capabilityPack);
  if (!pack) {
    throw new Error(`assignment route metadata references unknown capability_pack: ${capabilityPack}`);
  }
  if (hunterAgent !== pack.hunter_agent) {
    throw new Error(`assignment route metadata hunter_agent ${hunterAgent} does not match pack ${capabilityPack}`);
  }
  if (briefProfile !== pack.brief_profile) {
    throw new Error(`assignment route metadata brief_profile ${briefProfile} does not match pack ${capabilityPack}`);
  }

  return {
    capability_pack: capabilityPack,
    hunter_agent: hunterAgent,
    brief_profile: briefProfile,
  };
}

module.exports = {
  CAPABILITY_PACKS,
  WEB_SURFACE_TYPES,
  classifySurfaceCapability,
  defaultWebRouteMetadata,
  getCapabilityPack,
  normalizeAssignmentRouteMetadata,
  normalizeSurfaceType,
};
