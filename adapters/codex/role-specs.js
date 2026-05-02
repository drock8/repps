"use strict";

const CODEX_ROLE_SPECS = Object.freeze({
  recon: Object.freeze({
    bob_role: "recon-agent",
    agent_type: "worker",
    lifecycle: "wait",
  }),
  "deep-recon": Object.freeze({
    bob_role: "deep-recon-agent",
    agent_type: "worker",
    lifecycle: "wait",
  }),
  hunter: Object.freeze({
    bob_role: "hunter-agent",
    agent_type: "worker",
    lifecycle: "async_wave",
    bob_agent_id_source: "bounty_start_wave.data.assignments[].agent",
  }),
  "hunter-evm": Object.freeze({
    bob_role: "hunter-evm-agent",
    agent_type: "worker",
    lifecycle: "async_wave",
    bob_agent_id_source: "bounty_start_wave.data.assignments[].agent",
  }),
  "hunter-svm": Object.freeze({
    bob_role: "hunter-svm-agent",
    agent_type: "worker",
    lifecycle: "async_wave",
    bob_agent_id_source: "bounty_start_wave.data.assignments[].agent",
  }),
  "hunter-move": Object.freeze({
    bob_role: "hunter-move-agent",
    agent_type: "worker",
    lifecycle: "async_wave",
    bob_agent_id_source: "bounty_start_wave.data.assignments[].agent",
  }),
  "hunter-substrate": Object.freeze({
    bob_role: "hunter-substrate-agent",
    agent_type: "worker",
    lifecycle: "async_wave",
    bob_agent_id_source: "bounty_start_wave.data.assignments[].agent",
  }),
  "hunter-cosmwasm": Object.freeze({
    bob_role: "hunter-cosmwasm-agent",
    agent_type: "worker",
    lifecycle: "async_wave",
    bob_agent_id_source: "bounty_start_wave.data.assignments[].agent",
  }),
  chain: Object.freeze({
    bob_role: "chain-builder",
    agent_type: "worker",
    lifecycle: "wait",
  }),
  "brutalist-verifier": Object.freeze({
    bob_role: "brutalist-verifier",
    agent_type: "worker",
    lifecycle: "wait",
  }),
  "balanced-verifier": Object.freeze({
    bob_role: "balanced-verifier",
    agent_type: "worker",
    lifecycle: "wait",
  }),
  "final-verifier": Object.freeze({
    bob_role: "final-verifier",
    agent_type: "worker",
    lifecycle: "wait",
  }),
  evidence: Object.freeze({
    bob_role: "evidence-agent",
    agent_type: "worker",
    lifecycle: "wait",
  }),
  grader: Object.freeze({
    bob_role: "grader",
    agent_type: "worker",
    lifecycle: "wait",
  }),
  reporter: Object.freeze({
    bob_role: "report-writer",
    agent_type: "worker",
    lifecycle: "wait",
  }),
});

function codexRoleSpec(roleId) {
  const spec = CODEX_ROLE_SPECS[roleId];
  if (!spec) throw new Error(`Missing Codex role spec for ${roleId}`);
  return spec;
}

module.exports = {
  CODEX_ROLE_SPECS,
  codexRoleSpec,
};
