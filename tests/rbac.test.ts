import assert from "node:assert/strict";
import test from "node:test";
import {
  can,
  canWithGrants,
  parseGrants,
  ROLES,
  ROLE_META,
  GRANTABLE_CAPABILITIES,
  type Capability,
  type Role,
} from "../src/lib/session";

const CAPABILITIES: Capability[] = [
  "view",
  "manage_agents",
  "manage_credentials",
  "manage_grants",
  "approve",
  "manage_team",
  "manage_billing",
  "delete_org",
  "manage_security",
  "write_production",
  "kill_switch",
];

const EXPECTED: Record<Role, Capability[]> = {
  owner: [...CAPABILITIES],
  admin: [
    "view",
    "manage_agents",
    "manage_credentials",
    "manage_grants",
    "approve",
    "manage_team",
    "manage_security",
    "write_production",
    "kill_switch",
  ],
  developer: ["view", "manage_agents", "manage_credentials", "manage_grants", "kill_switch"],
  approver: ["view", "approve"],
  auditor: ["view"],
  billing: ["view", "manage_billing"],
  viewer: ["view"],
};

test("capability matrix matches the documented role table", () => {
  for (const role of ROLES) {
    for (const capability of CAPABILITIES) {
      assert.equal(
        can(role, capability),
        EXPECTED[role].includes(capability),
        `${role} / ${capability}`,
      );
    }
  }
});

test("unknown or missing roles have no capabilities", () => {
  for (const capability of CAPABILITIES) {
    assert.equal(can(undefined, capability), false, capability);
    assert.equal(can("superadmin", capability), false, capability);
  }
});

test("destructive and money-moving capabilities stay narrow", () => {
  assert.deepEqual(ROLES.filter((role) => can(role, "delete_org")), ["owner"]);
  assert.deepEqual(ROLES.filter((role) => can(role, "manage_billing")), ["owner", "billing"]);
  assert.deepEqual(ROLES.filter((role) => can(role, "manage_team")), ["owner", "admin"]);
  assert.deepEqual(ROLES.filter((role) => can(role, "manage_security")), ["owner", "admin"]);
  assert.deepEqual(ROLES.filter((role) => can(role, "write_production")), ["owner", "admin"]);
  assert.deepEqual(ROLES.filter((role) => can(role, "approve")), ["owner", "admin", "approver"]);
});

test("read-only roles cannot mutate anything", () => {
  for (const role of ["auditor", "viewer", "billing"] as const) {
    const mutations = CAPABILITIES.filter((capability) => capability !== "view" && capability !== "manage_billing");
    for (const capability of mutations) {
      assert.equal(can(role, capability), false, `${role} / ${capability}`);
    }
  }
});

test("every role is documented", () => {
  for (const role of ROLES) {
    assert.ok(ROLE_META[role]?.label, role);
    assert.ok(ROLE_META[role]?.description, role);
  }
});

test("grant parsing strips unknown, non-grantable and duplicate entries", () => {
  assert.deepEqual(parseGrants(null), []);
  assert.deepEqual(parseGrants(""), []);
  assert.deepEqual(parseGrants("not json"), []);
  assert.deepEqual(parseGrants('{"approve":true}'), []);
  assert.deepEqual(
    parseGrants('["approve","delete_org","view","bogus","approve","manage_billing"]'),
    ["approve", "manage_billing"],
  );
});

test("grants can only extend grantable capabilities, never owner-only ones", () => {
  assert.deepEqual([...GRANTABLE_CAPABILITIES].sort(), [
    "approve",
    "kill_switch",
    "manage_agents",
    "manage_billing",
    "manage_credentials",
    "manage_grants",
    "manage_security",
    "manage_team",
    "write_production",
  ]);
  assert.equal(GRANTABLE_CAPABILITIES.includes("delete_org" as never), false);
  assert.equal(GRANTABLE_CAPABILITIES.includes("view" as never), false);
});

test("viewer keeps read access but gains only what was explicitly granted", () => {
  assert.equal(canWithGrants("viewer", [], "view"), true);
  assert.equal(canWithGrants("viewer", [], "approve"), false);
  assert.equal(canWithGrants("viewer", ["approve"], "approve"), true);
  assert.equal(canWithGrants("viewer", ["approve"], "manage_agents"), false);
  assert.equal(canWithGrants("viewer", ["manage_security"], "manage_security"), true);
});

test("grants never confer delete_org or view", () => {
  assert.equal(canWithGrants("admin", ["delete_org" as never], "delete_org"), false);
  assert.equal(canWithGrants(undefined, ["view" as never], "view"), false);
  assert.equal(canWithGrants("developer", ["write_production"], "manage_agents"), true);
});

test("owner is never downgraded by grants or missing grants", () => {
  assert.equal(canWithGrants("owner", [], "delete_org"), true);
  assert.equal(canWithGrants("owner", [], "manage_billing"), true);
  assert.equal(canWithGrants("owner", [], "write_production"), true);
});

test("billing is scoped to billing only", () => {
  assert.equal(canWithGrants("billing", [], "manage_billing"), true);
  assert.equal(canWithGrants("billing", [], "approve"), false);
  assert.equal(canWithGrants("billing", [], "manage_agents"), false);
  assert.equal(canWithGrants("billing", ["approve"], "approve"), true);
  assert.equal(canWithGrants("billing", ["approve"], "delete_org"), false);
});
