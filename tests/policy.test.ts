import assert from "node:assert/strict";
import test from "node:test";
import { globMatch, envSettings, cidrMatch, normalizeIp, withinTimeWindow } from "../src/lib/policy";

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

test("cidrMatch handles IPv4 ranges", () => {
  assert.equal(cidrMatch("10.1.2.3", "10.0.0.0/8"), true);
  assert.equal(cidrMatch("11.1.2.3", "10.0.0.0/8"), false);
  assert.equal(cidrMatch("192.168.1.50", "192.168.1.0/24"), true);
  assert.equal(cidrMatch("192.168.2.50", "192.168.1.0/24"), false);
  assert.equal(cidrMatch("203.0.113.7", "203.0.113.7"), true);
  assert.equal(cidrMatch("203.0.113.8", "203.0.113.7"), false);
  assert.equal(cidrMatch("8.8.8.8", "0.0.0.0/0"), true);
});

test("cidrMatch handles IPv6 ranges and IPv4-mapped addresses", () => {
  assert.equal(cidrMatch("2001:db8::1", "2001:db8::/32"), true);
  assert.equal(cidrMatch("2001:db9::1", "2001:db8::/32"), false);
  assert.equal(cidrMatch("::1", "::1"), true);
  assert.equal(cidrMatch("::ffff:10.1.2.3", "10.0.0.0/8"), true);
  assert.equal(cidrMatch("10.1.2.3", "2001:db8::/32"), false);
  assert.equal(cidrMatch("2001:db8::1", "10.0.0.0/8"), false);
});

test("cidrMatch supports legacy dotted-prefix rules", () => {
  assert.equal(cidrMatch("10.0.0.7", "10.0.0."), true);
  assert.equal(cidrMatch("10.0.1.7", "10.0.0."), false);
  assert.equal(cidrMatch("10.9.8.7", "10."), true);
});

test("cidrMatch rejects malformed input", () => {
  assert.equal(cidrMatch("not-an-ip", "10.0.0.0/8"), false);
  assert.equal(cidrMatch("10.0.0.1", "not-a-range"), false);
  assert.equal(cidrMatch("10.0.0.1", "10.0.0.0/33"), false);
  assert.equal(cidrMatch("10.0.0.1", "300.0.0.0/8"), false);
  assert.equal(cidrMatch("10.0.0.1", "10.0.0.0/abc"), false);
  assert.equal(cidrMatch("", ""), false);
});

test("normalizeIp strips brackets and unwraps IPv4-mapped addresses", () => {
  assert.equal(normalizeIp("[2001:db8::1]"), "2001:db8::1");
  assert.equal(normalizeIp("[2001:db8::1]:443"), "2001:db8::1");
  assert.equal(normalizeIp("::ffff:192.168.0.5"), "192.168.0.5");
  assert.equal(normalizeIp("  10.0.0.1  "), "10.0.0.1");
});

test("time and day conditions fail closed on malformed values", () => {
  const mondayNoon = new Date("2026-11-09T12:00:00Z");
  assert.equal(withinTimeWindow({}, mondayNoon).ok, true);
  assert.equal(withinTimeWindow({ allowedDays: "mon" }, mondayNoon).ok, true);
  assert.equal(withinTimeWindow({ allowedDays: "tue" }, mondayNoon).ok, false);
  assert.equal(withinTimeWindow({ allowedDays: ["mon"] }, mondayNoon).ok, false);
  assert.equal(withinTimeWindow({ timeWindowStart: 9 }, mondayNoon).ok, false);
  assert.equal(withinTimeWindow({ timeWindowStart: "25:00" }, mondayNoon).ok, false);
  assert.equal(withinTimeWindow({ timeWindowStart: "13:00" }, mondayNoon).ok, false);
  assert.equal(withinTimeWindow({ timeWindowStart: "11:00", timeWindowEnd: "13:00" }, mondayNoon).ok, true);
  assert.equal(withinTimeWindow({ allowedDays: "funday" }, mondayNoon).ok, false);
  assert.equal(withinTimeWindow({ timezone: "Not/AZone" }, mondayNoon).ok, false);
  assert.equal(withinTimeWindow({ allowedDays: "" }, mondayNoon).ok, true);
});
