import fs from "node:fs";
import path from "node:path";

/** 启动后先等 UI/会话恢复稳定，再检查是否自动解封。 */
export const SEALED_GUARD_DELAY_MS = 8000;
const SEALED_GUARD_VERSION = 1;

export function guardPath(dshHome) {
  return path.join(dshHome, "dsh-purge", "sealed-guard.json");
}

export function sameAsarIdentity(left, right) {
  return Boolean(
    left && right
    && Number(left.size) === Number(right.size)
    && Number(left.mtimeMs) === Number(right.mtimeMs),
  );
}

export function readGuardState(dshHome) {
  if (!dshHome) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(guardPath(dshHome), "utf8"));
    if (Number(raw?.version) !== SEALED_GUARD_VERSION) return null;
    const asar = raw.asar;
    if (!asar || !Number.isFinite(Number(asar.size)) || !Number.isFinite(Number(asar.mtimeMs))) return null;
    return {
      version: SEALED_GUARD_VERSION,
      asar: { size: Number(asar.size), mtimeMs: Number(asar.mtimeMs) },
      at: typeof raw.at === "string" ? raw.at : "",
      result: typeof raw.result === "string" ? raw.result : "",
    };
  } catch {
    return null;
  }
}

export function writeGuardState(dshHome, { asar, at = new Date().toISOString(), result = "scheduled" } = {}) {
  if (!dshHome || !asar) return false;
  const fp = guardPath(dshHome);
  const tmp = `${fp}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify({
      version: SEALED_GUARD_VERSION,
      asar: { size: Number(asar.size), mtimeMs: Number(asar.mtimeMs) },
      at,
      result,
    }, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, fp);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* 临时文件可能没写出来 */ }
    return false;
  }
}

export function clearGuardState(dshHome) {
  if (!dshHome) return;
  try { fs.unlinkSync(guardPath(dshHome)); } catch { /* 本来就没有 */ }
}

/**
 * 一次 asar 只自动解封一次：换包失败又回到密封态时，下次启动只记日志，
 * 等用户点「应用」，避免重打→重启→再重打的死循环。
 */
export function planSealedAutoUnseal({
  enabled = true,
  surface = "desktop",
  sealed = false,
  ready = false,
  asar = null,
  state = null,
} = {}) {
  if (!enabled) return { action: "skip", reason: "disabled" };
  if (surface !== "desktop") return { action: "skip", reason: "not-desktop" };
  if (!sealed) return { action: "skip", reason: "not-sealed" };
  if (!asar) return { action: "skip", reason: "no-archive" };
  if (!ready) return { action: "wait-apply", reason: "unpacked-stale" };
  if (state && sameAsarIdentity(state.asar, asar)) {
    return { action: "skip", reason: "already-attempted" };
  }
  return { action: "restart", reason: "unseal" };
}
