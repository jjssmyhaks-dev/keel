import assert from "node:assert/strict";
import test from "node:test";
import { globMatch, envSettings } from "../src/lib/policy";

test("wildcard patterns", () => {
  assert.equal(globMatch("*", "slack:channels:list"), true);
  assert.equal(globMatch("", "anything"), true);
  assert.equal(globMatch("slack:*", "slack:channels:list"), true);
  assert.equal(globMatch("slack:*", "github:issues:list"), false);
  assert.equal(globMatch("*:list", "slack:channels:list"), true);
  assert.equal(globMatch("*:list", "slack:channels:archive"), false);
});

test("comma-separated patterns act as an allow-list", () => {
  assert.equal(globMatch("slack:channels:list,github:issues:read", "github:issues:read"), true);
  assert.equal(globMatch("slack:channels:list, github:issues:read", "github:issues:read"), true);
  assert.equal(globMatch("slack:channels:list,github:issues:read", "stripe:refunds:create"), false);
});

test("question mark matches a single character", () => {
  assert.equal(globMatch("agent-?", "agent-7"), true);
  assert.equal(globMatch("agent-?", "agent-77"), false);
});

test("matching is case-insensitive", () => {
  assert.equal(globMatch("Slack:Channels:List", "slack:channels:list"), true);
});

test("regex metacharacters are treated literally", () => {
  assert.equal(globMatch("a.b", "a.b"), true);
  assert.equal(globMatch("a.b", "axb"), false);
  assert.equal(globMatch("resource(id)", "resource(id)"), true);
  assert.equal(globMatch("resource(id)", "resourceXid"), false);
});

test("a restricted pattern requires a matching resource", () => {
  assert.equal(globMatch("channel:*", "channel:general"), true);
  assert.equal(globMatch("channel:*", "channel:random/extra"), true);
  assert.equal(globMatch("channel:*", "user:general"), false);
});

test("envSettings parses valid JSON and survives corrupt settings", () => {
  assert.deepEqual(envSettings({ settingsJson: '{"autoApproveDev":true}' }), { autoApproveDev: true });
  assert.deepEqual(envSettings({ settingsJson: "" }), {});
  assert.deepEqual(envSettings({ settingsJson: "{not json" }), {});
});
