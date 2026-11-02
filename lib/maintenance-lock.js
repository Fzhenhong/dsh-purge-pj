// 维护锁：把「改宿主文件」这件事串行化。
//
// 吸收自 kingcharleslzy-ai/dsh-purge 的 lib/maintenance-lock.js（社区版），
// 保留它最重要的一条判据 —— **租约年龄永远不能证明进程已死**：
//
//   · 只看 mtime 判断「锁太老了可以抢」，会在维护进程正好写文件的时候把锁抢走，
//     两边同时写同一份 client.js，结果是一半补丁在、一半不在，且没有任何报错。
//   · 所以判断死活只看 PID：kill(pid,0) 拿到 ESRCH 才算死；EPERM 一律当活。
//   · PID 会被复用。所以还要求「当前这个 PID 的进程创建时间晚于锁的创建时间」，
//     只有这样才能把「旧锁的 PID 被系统分给了别的进程」和「原维护进程还活着」分开。
//
// 落盘形态用「目录 + 唯一文件名」而不是单个 lock 文件：
//   · 单个 lock 文件要先写内容再 rename，中间存在空文件窗口；
//   · 目录 rename 是原子的，rename 成功那一刻目录里已经有完整属主 JSON，
//     不存在「锁在、内容还没写完」的中间态。
//   · 另外用 hardlink 造一个 maintenance.lock 兼容名，两个名字指向同一个 inode，
//     校验时比对 inode+dev —— 有人手改/复制其中一个立刻能看出来（LOCK_LOST）。
//
// 失败语义（调用方按 code 分支，不要按文案）：
//   MAINTENANCE_BUSY   别人正拿着锁，或遗留锁的属主还没死 / 无法确认
//   LOCK_LOST          锁的归属对不上（inode 变了、内容被改），本次操作立即停
//   LOCK_UNREADABLE    连续读失败，归属未知
//   LOCK_RELEASE_FAILED 释放没成功，锁留在原地，下次 acquire 会先重试释放
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const host = os.hostname();
const born = Date.now() - process.uptime() * 1000;
// 只存本进程显式释放失败的锁：下次 acquire 同一个 base 时先补一次释放。
const pendingReleases = new Map();

const absent = (error) => error?.code === "ENOENT";
const busy = (detail) => Object.assign(
  new Error(`已有维护操作或遗留锁：${detail}；未并发修改。请确认原维护进程已退出，不要直接删除活动锁。`),
  { code: "MAINTENANCE_BUSY" },
);
const lost = () => Object.assign(
  new Error("维护锁归属无法确认，本次操作已停止；保留备份与恢复目录，未继续写入或自动恢复。"),
  { code: "LOCK_LOST" },
);

function processBirth(pid) {
  if (pid === process.pid) return born;
  try {
    if (process.platform === "win32") {
      const command = `$p=Get-Process -Id ${pid} -ErrorAction Stop; ([DateTimeOffset]$p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()`;
      return Number(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
        encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
      }).trim());
    }
    const text = execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8", timeout: 5000, env: { ...process.env, LC_ALL: "C" }, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return Date.parse(text);
  } catch { return NaN; }
}

function ownerFrom(raw, createdAt) {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object") return value;
  } catch { /* 老格式，往下按冒号切 */ }
  const parts = String(raw || "").trim().split(":");
  return {
    host: parts.length >= 3 ? parts[0] : host,
    pid: Number(parts.length >= 3 ? parts[1] : parts[0]),
    createdAt,
  };
}

function ownerDead(owner, io) {
  if (owner.host !== host || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try { io.kill(owner.pid, 0); }
  catch (error) { return error?.code === "ESRCH"; } // EPERM / 未知一律不当死。
  // PID 复用：当前进程必须晚于锁的创建时间才算「不是原属主」。
  // 2000ms 余量覆盖 ps 的秒级精度与调度抖动。
  const start = io.birth(owner.pid);
  return Number.isFinite(start) && Number.isFinite(owner.createdAt) && start > owner.createdAt + 2000;
}

function regular(io, file, links = 1) {
  const stat = io.fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== links) throw busy("锁文件类型异常，保留现场");
  return stat;
}

/**
 * 取得 base 目录下的维护锁。成功返回 { check, release }：
 *   check()   —— 确认锁还在自己手里，被抢/被改抛 LOCK_LOST；
 *   release() —— 释放，返回 null 表示干净释放，否则返回 { stage, code } 说明失败阶段。
 * options 可注入 { fs, kill, birth } 供单测替身。
 */
export function acquireMaintenanceLock(base, options = {}) {
  const io = { fs, kill: process.kill.bind(process), birth: processBirth, ...options };
  base = path.resolve(base);
  const pending = pendingReleases.get(base);
  if (pending) {
    const warning = pending();
    if (warning) throw Object.assign(busy("上次释放失败，原锁保留"), { cause: warning });
  }
  const gate = path.join(base, "maintenance.guard");
  const legacy = path.join(base, "maintenance.lock");
  const token = randomBytes(16).toString("hex");
  const name = `${token}.json`;
  const owner = { schema: 1, host, pid: process.pid, createdAt: Date.now(), token };
  const raw = JSON.stringify(owner);
  const stage = path.join(base, `.maintenance-${token}`);
  io.fs.mkdirSync(stage, { mode: 0o700 });
  try { io.fs.writeFileSync(path.join(stage, name), raw, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    try { io.fs.unlinkSync(path.join(stage, name)); io.fs.rmdirSync(stage); } catch { /* 清不干净也没留锁 */ }
    throw error;
  }
  let held = false;
  let compatibility = false;

  function pair() {
    const a = regular(io, path.join(gate, name), 2);
    const b = regular(io, legacy, 2);
    if (a.ino !== b.ino || a.dev !== b.dev) throw lost();
  }

  function check() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (!held
          || io.fs.readFileSync(path.join(gate, name), "utf8") !== raw
          || io.fs.readFileSync(legacy, "utf8") !== raw) throw lost();
        pair();
        return;
      } catch (error) {
        if (error.code === "LOCK_LOST" || absent(error)) throw Object.assign(lost(), { cause: error });
        // 类型/链接异常是「已经确定的现场」，重试不会变好，也不该被降级成「读不到」。
        if (error.code === "MAINTENANCE_BUSY") throw error;
        if (attempt === 2) {
          throw Object.assign(
            new Error("维护锁读取失败，归属未知；停止后续写入，保留恢复目录。"),
            { code: "LOCK_UNREADABLE", cause: error },
          );
        }
      }
    }
  }

  function release() {
    // 释放失败要保留现场：直接把锁删掉，等于允许下一个进程在原维护进程还在写的时候进来。
    // 只有本进程还记得这份属主闭包，下次 acquire 才能替它补完。
    let failure;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (compatibility) {
          check();
          io.fs.unlinkSync(legacy);
          compatibility = false;
        }
        if (held) {
          if (io.fs.readFileSync(path.join(gate, name), "utf8") !== raw) throw lost();
          io.fs.unlinkSync(path.join(gate, name));
          held = false;
          try { io.fs.rmdirSync(gate); }
          catch (e) { if (!absent(e) && !["ENOTEMPTY", "EEXIST"].includes(e.code)) throw e; }
        }
        pendingReleases.delete(base);
        return null;
      } catch (error) { failure = error; }
    }
    if (failure?.code === "LOCK_LOST") pendingReleases.delete(base);
    else pendingReleases.set(base, release);
    return { stage: "lock-release", code: failure?.code || "LOCK_RELEASE_FAILED", cause: failure?.cause?.code };
  }

  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        // rename 一个非空目录过去：原子，且不会暴露空锁路径。
        io.fs.renameSync(stage, gate);
        held = true;
        break;
      } catch (error) {
        let stat;
        try { stat = io.fs.lstatSync(gate); }
        catch (e) {
          if (absent(e)) {
            if (["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(error.code)) continue;
            throw error;
          }
          throw e;
        }
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw busy("维护互斥目录类型异常");
        let names;
        try { names = io.fs.readdirSync(gate); }
        catch (e) { if (absent(e)) continue; throw e; }
        if (names.length === 0) {
          try { io.fs.rmdirSync(gate); }
          catch (e) { if (!absent(e) && e.code !== "ENOTEMPTY" && e.code !== "EEXIST") throw e; }
          continue;
        }
        if (names.length !== 1 || !/^[a-f0-9]{32}\.json$/.test(names[0])) throw busy("维护互斥目录内容未知");
        const file = path.join(gate, names[0]);
        try {
          const entry = io.fs.lstatSync(file);
          if (entry.nlink === 2) {
            const peer = regular(io, legacy, 2);
            if (peer.ino !== entry.ino || peer.dev !== entry.dev) throw busy("锁硬链接不属于当前维护记录");
            regular(io, file, 2);
          } else regular(io, file);
          const prior = ownerFrom(io.fs.readFileSync(file, "utf8"), NaN);
          if (!ownerDead(prior, io)) throw busy(`进程 ${prior.pid || "未知"} 的归属尚未结束或无法确认`);
          // 只删死属主那一个唯一文件名。抢锁的对手会发布另一个非空目录，rmdir 会安全失败。
          io.fs.unlinkSync(file);
          try { io.fs.rmdirSync(gate); }
          catch (e) { if (!absent(e) && e.code !== "ENOTEMPTY" && e.code !== "EEXIST") throw e; }
        } catch (e) { if (!absent(e)) throw e; }
      }
    }
    if (!held) throw busy("其他维护进程正在接管");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        // 内容已写完才建兼容名：崩溃不会留下空 maintenance.lock。两个名字同一个 inode。
        io.fs.linkSync(path.join(gate, name), legacy);
        compatibility = true;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          const stat = regular(io, legacy);
          const previous = io.fs.readFileSync(legacy, "utf8");
          const prior = ownerFrom(previous, stat.mtimeMs);
          if (!ownerDead(prior, io)) {
            throw busy(`旧锁 PID=${prior.pid || "未知"}，mtime=${stat.mtime.toISOString()}，存活或归属未知`);
          }
          if (io.fs.readFileSync(legacy, "utf8") !== previous) throw busy("旧锁在检查期间变化");
          const current = regular(io, legacy);
          if (current.ino !== stat.ino || current.dev !== stat.dev || current.mtimeMs !== stat.mtimeMs) {
            throw busy("旧锁在检查期间变化");
          }
          io.fs.unlinkSync(legacy);
        } catch (e) { if (!absent(e)) throw e; }
        continue;
      }
      check();
      return { check, release };
    }
    throw busy("未取得维护锁");
  } catch (error) {
    release();
    throw error;
  } finally {
    try { io.fs.unlinkSync(path.join(stage, name)); } catch { /* 已被 rename 走 */ }
    try { io.fs.rmdirSync(stage); } catch { /* 同上 */ }
  }
}

/** 取锁跑一段同步/异步工作，结束后无论成败都释放。释放失败只回传，不掩盖原错误。 */
export async function withMaintenanceLock(base, fn, options = {}) {
  const lock = acquireMaintenanceLock(base, options);
  try {
    const result = await fn(lock);
    return { result, releaseWarning: lock.release() };
  } catch (error) {
    const warning = lock.release();
    if (warning) {
      try { error.releaseWarning = warning; } catch { /* 冻结对象就算了 */ }
    }
    throw error;
  }
}

export const MAINTENANCE_ERRORS = Object.freeze({
  BUSY: "MAINTENANCE_BUSY",
  LOST: "LOCK_LOST",
  UNREADABLE: "LOCK_UNREADABLE",
  RELEASE_FAILED: "LOCK_RELEASE_FAILED",
});
