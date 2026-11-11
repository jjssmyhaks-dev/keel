import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STATUS_COMPONENTS,
  componentState,
  impactRank,
  isIncidentImpact,
  isIncidentStatus,
  isStatusComponent,
  overallState,
  sortOpenIncidents,
} from "../src/lib/status";

test("overallState reports operational only when no incidents are open", () => {
  assert.equal(overallState([]), "operational");
  assert.equal(overallState([{ component: "Agent proxy", impact: "minor", status: "investigating" }]), "degraded");
  assert.equal(overallState([{ component: "Agent proxy", impact: "maintenance", status: "monitoring" }]), "maintenance");
});

test("overallState escalates to outage for critical incidents", () => {
  assert.equal(
    overallState([
      { component: "Agent proxy", impact: "minor", status: "monitoring" },
      { component: "Metadata store", impact: "critical", status: "investigating" },
    ]),
    "outage",
  );
  assert.equal(
    overallState([
      { component: "Agent proxy", impact: "maintenance", status: "monitoring" },
      { component: "Metadata store", impact: "major", status: "identified" },
    ]),
    "degraded",
  );
});

test("componentState merges live checks with open incidents", () => {
  assert.equal(componentState("Agent proxy", true, []), "operational");
  assert.equal(componentState("Agent proxy", false, []), "degraded");
  assert.equal(
    componentState("Agent proxy", true, [{ component: "Agent proxy", impact: "maintenance", status: "monitoring" }]),
    "maintenance",
  );
  assert.equal(
    componentState("Agent proxy", true, [{ component: "Agent proxy", impact: "major", status: "identified" }]),
    "degraded",
  );
  assert.equal(
    componentState("Agent proxy", true, [{ component: "Token signing", impact: "major", status: "identified" }]),
    "operational",
  );
});

test("status vocabularies reject values outside the contract", () => {
  assert.ok(STATUS_COMPONENTS.every((component) => isStatusComponent(component)));
  assert.equal(isStatusComponent("Billing"), false);
  assert.deepEqual(
    ["minor", "major", "critical", "maintenance"].filter((impact) => isIncidentImpact(impact)),
    ["minor", "major", "critical", "maintenance"],
  );
  assert.equal(isIncidentImpact("severe"), false);
  assert.equal(isIncidentStatus("resolved"), true);
  assert.equal(isIncidentStatus("closed"), false);
});

test("incidents sort by severity before recency", () => {
  const older = new Date("2026-11-01T10:00:00Z");
  const newer = new Date("2026-11-02T10:00:00Z");
  const sorted = sortOpenIncidents([
    { component: "Agent proxy", impact: "minor", status: "investigating", startedAt: newer },
    { component: "Token signing", impact: "critical", status: "identified", startedAt: older },
    { component: "Audit pipeline", impact: "major", status: "monitoring", startedAt: older },
  ]);
  assert.deepEqual(
    sorted.map((incident) => incident.impact),
    ["critical", "major", "minor"],
  );
  assert.equal(impactRank("critical") > impactRank("major"), true);
  assert.equal(impactRank("unknown"), 0);
});
