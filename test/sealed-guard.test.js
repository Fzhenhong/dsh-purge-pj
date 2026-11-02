import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearGuardState,
  planSealedAutoUnseal,
  readGuardState,
  sameAsarIdentity,
  writeGuardState,
} from "../lib/sealed-guard.js";

const asar = { size: 182766714, mtimeMs: 1793282572000 };

test("planSealedAutoUnseal 只有桌面、密封、已解包且没试过才重启", () => {
  assert.deepEqual(planSealedAutoUnseal({ enabled: false, sealed: true, ready: true, asar }), { action: "skip", reason: "disabled" });
  assert.deepEqual(planSealedAutoUnseal({ surface: "web", sealed: true, ready: true, asar }), { action: "skip", reason: "not-desktop" });
  assert.deepEqual(planSealedAutoUnseal({ sealed: false, ready: true, asar }), { action: "skip", reason: "not-sealed" });
  assert.deepEqual(planSealedAutoUnseal({ sealed: true, ready: true, asar: null }), { action: "skip", reason: "no-archive" });
  assert.deepEqual(planSealedAutoUnseal({ sealed: true, ready: false, asar }), { action: "wait-apply", reason: "unpacked-stale" });
  assert.deepEqual(planSealedAutoUnseal({ sealed: true, ready: true, asar }), { action: "restart", reason: "unseal" });
});

test("planSealedAutoUnseal 同一份 asar 只自动尝试一次", () => {
  const state = { asar: { ...asar }, at: "2026-10-31T00:00:00.000Z" };
  assert.deepEqual(planSealedAutoUnseal({ sealed: true, ready: true, asar, state }), { action: "skip", reason: "already-attempted" });
  const nextBuild = { size: asar.size, mtimeMs: asar.mtimeMs + 1 };
  assert.deepEqual(planSealedAutoUnseal({ sealed: true, ready: true, asar: nextBuild, state }), { action: "restart", reason: "unseal" });
});

test("sameAsarIdentity 按大小和修改时间比较", () => {
  assert.equal(sameAsarIdentity(asar, { ...asar }), true);
  assert.equal(sameAsarIdentity(asar, { ...asar, mtimeMs: asar.mtimeMs + 1 }), false);
  assert.equal(sameAsarIdentity(asar, null), false);
});

test("sealed guard 状态落盘、读取和清除", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-sealed-guard-"));
  try {
    assert.equal(readGuardState(home), null);
    assert.equal(writeGuardState(home, { asar, at: "2026-10-31T00:00:00.000Z" }), true);
    const state = readGuardState(home);
    assert.deepEqual(state.asar, asar);
    assert.equal(state.at, "2026-10-31T00:00:00.000Z");
    assert.equal(state.result, "scheduled");
    clearGuardState(home);
    assert.equal(readGuardState(home), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
