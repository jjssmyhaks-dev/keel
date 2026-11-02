import assert from "node:assert/strict";
import test from "node:test";
import { inviteState } from "../src/lib/invitations";

const now = new Date("2026-11-02T10:00:00Z");
const future = new Date("2026-11-09T10:00:00Z");
const past = new Date("2026-10-26T10:00:00Z");

test("a fresh invitation is acceptable by the invited email", () => {
  const state = inviteState({
    expiresAt: future,
    acceptedAt: null,
    invitedEmail: "teammate@example.com",
    sessionEmail: "teammate@example.com",
    now,
  });
  assert.deepEqual(state, { expired: false, accepted: false, emailMismatch: false, canAccept: true });
});

test("the invited email check is case-insensitive", () => {
  const state = inviteState({
    expiresAt: future,
    acceptedAt: null,
    invitedEmail: "Teammate@Example.com",
    sessionEmail: "teammate@example.com",
    now,
  });
  assert.equal(state.emailMismatch, false);
  assert.equal(state.canAccept, true);
});

test("a different account cannot accept the invitation", () => {
  const state = inviteState({
    expiresAt: future,
    acceptedAt: null,
    invitedEmail: "teammate@example.com",
    sessionEmail: "someone-else@example.com",
    now,
  });
  assert.equal(state.emailMismatch, true);
  assert.equal(state.canAccept, false);
});

test("signed-out visitors can view but not accept", () => {
  const state = inviteState({
    expiresAt: future,
    acceptedAt: null,
    invitedEmail: "teammate@example.com",
    sessionEmail: null,
    now,
  });
  assert.equal(state.emailMismatch, false);
  assert.equal(state.canAccept, false);
});

test("an expired invitation is rejected", () => {
  const state = inviteState({
    expiresAt: past,
    acceptedAt: null,
    invitedEmail: "teammate@example.com",
    sessionEmail: "teammate@example.com",
    now,
  });
  assert.equal(state.expired, true);
  assert.equal(state.canAccept, false);
});

test("the expiry boundary is inclusive until now passes", () => {
  const state = inviteState({
    expiresAt: now,
    acceptedAt: null,
    invitedEmail: "teammate@example.com",
    sessionEmail: "teammate@example.com",
    now,
  });
  assert.equal(state.expired, false);
  assert.equal(state.canAccept, true);
});

test("a used invitation cannot be reused", () => {
  const state = inviteState({
    expiresAt: future,
    acceptedAt: new Date("2026-11-01T08:00:00Z"),
    invitedEmail: "teammate@example.com",
    sessionEmail: "teammate@example.com",
    now,
  });
  assert.equal(state.accepted, true);
  assert.equal(state.canAccept, false);
});

test("acceptance requires email match, unused token and valid expiry together", () => {
  const state = inviteState({
    expiresAt: past,
    acceptedAt: new Date("2026-10-20T08:00:00Z"),
    invitedEmail: "teammate@example.com",
    sessionEmail: "someone-else@example.com",
    now,
  });
  assert.equal(state.expired, true);
  assert.equal(state.accepted, true);
  assert.equal(state.emailMismatch, true);
  assert.equal(state.canAccept, false);
});
