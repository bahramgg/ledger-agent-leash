import assert from "node:assert/strict";
import { test } from "node:test";

import { checkPolicy, SessionLedger, type Policy, type TransactionIntent } from "./policy.js";

const POLICY: Policy = {
  maxAmountPerTx: 0.1,
  dailyCap: 0.5,
  allowlist: ["GoodRecipient1111111111111111111111111111111"],
  blocklist: ["BadActor22222222222222222222222222222222222"],
};

const intent = (over: Partial<TransactionIntent> = {}): TransactionIntent => ({
  destination: POLICY.allowlist[0]!,
  amountSol: 0.01,
  token: "SOL",
  ...over,
});

test("ALLOW: small in-policy transfer to an allowlisted address", () => {
  const r = checkPolicy(intent(), POLICY, 0);
  assert.equal(r.decision, "ALLOW");
});

test("ALLOW: amount exactly at the per-transaction cap", () => {
  const r = checkPolicy(intent({ amountSol: POLICY.maxAmountPerTx }), POLICY, 0);
  assert.equal(r.decision, "ALLOW");
});

test("ALLOW: projected daily total exactly at the cap", () => {
  // already spent 0.4, +0.1 = 0.5 == dailyCap (not over)
  const r = checkPolicy(intent({ amountSol: 0.1 }), POLICY, 0.4);
  assert.equal(r.decision, "ALLOW");
});

test("BLOCK: amount over the per-transaction cap", () => {
  const r = checkPolicy(intent({ amountSol: 0.2 }), POLICY, 0);
  assert.equal(r.decision, "BLOCK");
  assert.match(r.reason, /per-transaction cap/);
});

test("BLOCK: cumulative spend would exceed the daily cap", () => {
  // 0.45 already spent, +0.1 = 0.55 > 0.5
  const r = checkPolicy(intent({ amountSol: 0.1 }), POLICY, 0.45);
  assert.equal(r.decision, "BLOCK");
  assert.match(r.reason, /daily cap/);
});

test("BLOCK: destination not on the allowlist", () => {
  const r = checkPolicy(intent({ destination: "SomeOtherAddr3333333333333333333333333333333" }), POLICY, 0);
  assert.equal(r.decision, "BLOCK");
  assert.match(r.reason, /allowlist/);
});

test("BLOCK: blocklisted destination is refused even if otherwise fine", () => {
  const r = checkPolicy(intent({ destination: POLICY.blocklist[0]! }), POLICY, 0);
  assert.equal(r.decision, "BLOCK");
  assert.match(r.reason, /blocklist/);
});

test("BLOCK: blocklist takes precedence over allowlist", () => {
  const conflict: Policy = { ...POLICY, allowlist: [POLICY.blocklist[0]!], blocklist: [POLICY.blocklist[0]!] };
  const r = checkPolicy(intent({ destination: conflict.blocklist[0]! }), conflict, 0);
  assert.equal(r.decision, "BLOCK");
  assert.match(r.reason, /blocklist/);
});

test("BLOCK: non-SOL token is rejected", () => {
  const r = checkPolicy(intent({ token: "USDC" }), POLICY, 0);
  assert.equal(r.decision, "BLOCK");
  assert.match(r.reason, /only SOL/);
});

test("BLOCK: zero / negative / non-finite amounts are rejected", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = checkPolicy(intent({ amountSol: bad }), POLICY, 0);
    assert.equal(r.decision, "BLOCK", `amount ${bad} should be blocked`);
  }
});

test("BLOCK: empty destination is rejected", () => {
  const r = checkPolicy(intent({ destination: "" }), POLICY, 0);
  assert.equal(r.decision, "BLOCK");
});

test("ALLOW: empty allowlist means any (non-blocklisted) destination is allowed", () => {
  const open: Policy = { ...POLICY, allowlist: [] };
  const r = checkPolicy(intent({ destination: "AnyAddr4444444444444444444444444444444444444" }), open, 0);
  assert.equal(r.decision, "ALLOW");
});

test("SessionLedger accumulates recorded spend", () => {
  const ledger = new SessionLedger();
  assert.equal(ledger.spentSol, 0);
  ledger.record(0.01);
  ledger.record(0.02);
  assert.equal(ledger.spentSol, 0.03);
});
