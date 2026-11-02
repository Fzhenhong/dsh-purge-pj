import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireMaintenanceLock, withMaintenanceLock, MAINTENANCE_ERRORS } from "../lib/maintenance-lock.js";

function tmpBase() {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-lock-"));
	return { base, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test("取锁后落盘的是「目录 + 唯一属主文件」和硬链接兼容名", () => {
	const { base, cleanup } = tmpBase();
	try {
		const lock = acquireMaintenanceLock(base);
		const names = fs.readdirSync(base).sort();
		assert.deepEqual(names, ["maintenance.guard", "maintenance.lock"]);
		const guard = fs.readdirSync(path.join(base, "maintenance.guard"));
		assert.equal(guard.length, 1);
		assert.match(guard[0], /^[a-f0-9]{32}\.json$/);
		// 两个名字必须是同一个 inode：任何一方被手改/复制都能被发现。
		const a = fs.statSync(path.join(base, "maintenance.guard", guard[0]));
		const b = fs.statSync(path.join(base, "maintenance.lock"));
		assert.equal(a.ino, b.ino);
		assert.equal(a.dev, b.dev);
		const owner = JSON.parse(fs.readFileSync(path.join(base, "maintenance.lock"), "utf8"));
		assert.equal(owner.pid, process.pid);
		assert.equal(owner.schema, 1);
		assert.equal(lock.release(), null);
		assert.deepEqual(fs.readdirSync(base), []);
	} finally { cleanup(); }
});

test("同一 base 第二次取锁得到 MAINTENANCE_BUSY，且不动原锁", () => {
	const { base, cleanup } = tmpBase();
	try {
		const lock = acquireMaintenanceLock(base);
		const before = fs.readdirSync(path.join(base, "maintenance.guard"));
		assert.throws(() => acquireMaintenanceLock(base), (e) => e.code === MAINTENANCE_ERRORS.BUSY);
		// 被拒的这次不能留下自己的残留目录
		assert.deepEqual(fs.readdirSync(path.join(base, "maintenance.guard")), before);
		assert.equal(fs.readdirSync(base).filter((n) => n.startsWith(".maintenance-")).length, 0);
		lock.release();
	} finally { cleanup(); }
});

test("check() 在属主文件被改后抛 LOCK_LOST", () => {
	const { base, cleanup } = tmpBase();
	try {
		const lock = acquireMaintenanceLock(base);
		const guard = path.join(base, "maintenance.guard", fs.readdirSync(path.join(base, "maintenance.guard"))[0]);
		// 内容被改写 = 归属不再可信
		const original = fs.readFileSync(guard, "utf8");
		fs.writeFileSync(guard, original.replace(/"token":"[a-f0-9]+"/, '"token":"deadbeef"'), "utf8");
		assert.throws(() => lock.check(), (e) => e.code === MAINTENANCE_ERRORS.LOST);
		lock.release();
	} finally { cleanup(); }
});

test("兼容名被换成独立副本（inode 不同、内容相同）时按 BUSY 保留现场", () => {
	const { base, cleanup } = tmpBase();
	try {
		const lock = acquireMaintenanceLock(base);
		// 把兼容名换成一份独立副本：内容一样但 inode 不同、nlink=1。
		// 这种「有人手工复制/替换过锁文件」的现场只能报警，不能当成自己的锁继续写。
		const text = fs.readFileSync(path.join(base, "maintenance.lock"), "utf8");
		fs.unlinkSync(path.join(base, "maintenance.lock"));
		fs.writeFileSync(path.join(base, "maintenance.lock"), text, "utf8");
		assert.throws(() => lock.check(), (e) => e.code === MAINTENANCE_ERRORS.BUSY);
		lock.release();
	} finally { cleanup(); }
});

test("属主进程已死（ESRCH）时遗留锁可被接管", () => {
	const { base, cleanup } = tmpBase();
	try {
		const dead = 999999;
		const guard = path.join(base, "maintenance.guard");
		fs.mkdirSync(guard, { recursive: true });
		const name = `${"a".repeat(32)}.json`;
		const raw = JSON.stringify({ schema: 1, host: os.hostname(), pid: dead, createdAt: Date.now(), token: "a".repeat(32) });
		fs.writeFileSync(path.join(guard, name), raw, "utf8");
		fs.linkSync(path.join(guard, name), path.join(base, "maintenance.lock"));
		const io = {
			kill: () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); },
			birth: () => NaN,
		};
		const lock = acquireMaintenanceLock(base, io);
		const owner = JSON.parse(fs.readFileSync(path.join(base, "maintenance.lock"), "utf8"));
		assert.equal(owner.pid, process.pid);
		lock.release();
	} finally { cleanup(); }
});

test("属主进程活着（EPERM 或 kill 成功）时拒绝接管", () => {
	const { base, cleanup } = tmpBase();
	try {
		const guard = path.join(base, "maintenance.guard");
		fs.mkdirSync(guard, { recursive: true });
		const name = `${"b".repeat(32)}.json`;
		const raw = JSON.stringify({ schema: 1, host: os.hostname(), pid: 4242, createdAt: Date.now(), token: "b".repeat(32) });
		fs.writeFileSync(path.join(guard, name), raw, "utf8");
		fs.linkSync(path.join(guard, name), path.join(base, "maintenance.lock"));
		// EPERM：进程存在但不属于我们 —— 一律当活
		const eperm = { kill: () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); }, birth: () => NaN };
		assert.throws(() => acquireMaintenanceLock(base, eperm), (e) => e.code === MAINTENANCE_ERRORS.BUSY);
		// kill 成功但拿不到创建时间：归属无法确认，同样不能抢
		const alive = { kill: () => {}, birth: () => NaN };
		assert.throws(() => acquireMaintenanceLock(base, alive), (e) => e.code === MAINTENANCE_ERRORS.BUSY);
	} finally { cleanup(); }
});

test("PID 被复用：进程存活但创建时间早于锁时视为原属主仍活，拒绝接管", () => {
	const { base, cleanup } = tmpBase();
	try {
		const guard = path.join(base, "maintenance.guard");
		fs.mkdirSync(guard, { recursive: true });
		const name = `${"c".repeat(32)}.json`;
		const created = Date.now();
		const raw = JSON.stringify({ schema: 1, host: os.hostname(), pid: 5150, createdAt: created, token: "c".repeat(32) });
		fs.writeFileSync(path.join(guard, name), raw, "utf8");
		fs.linkSync(path.join(guard, name), path.join(base, "maintenance.lock"));
		// 存活 + 创建时间早于锁 → 原进程还没死
		const older = { kill: () => {}, birth: () => created - 60000 };
		assert.throws(() => acquireMaintenanceLock(base, older), (e) => e.code === MAINTENANCE_ERRORS.BUSY);
		// 存活 + 创建时间晚于锁 2s 以上 → PID 被复用，可以接管
		const reused = { kill: () => {}, birth: () => created + 60000 };
		const lock = acquireMaintenanceLock(base, reused);
		assert.equal(JSON.parse(fs.readFileSync(path.join(base, "maintenance.lock"), "utf8")).pid, process.pid);
		lock.release();
	} finally { cleanup(); }
});

test("锁目录里出现未知内容时按 BUSY 保留现场，不猜不删", () => {
	const { base, cleanup } = tmpBase();
	try {
		const guard = path.join(base, "maintenance.guard");
		fs.mkdirSync(guard, { recursive: true });
		fs.writeFileSync(path.join(guard, "notes.txt"), "user's own file", "utf8");
		assert.throws(() => acquireMaintenanceLock(base), (e) => e.code === MAINTENANCE_ERRORS.BUSY);
		assert.equal(fs.readFileSync(path.join(guard, "notes.txt"), "utf8"), "user's own file");
	} finally { cleanup(); }
});

test("withMaintenanceLock 在 fn 抛错时也释放锁，并保留原错误", async () => {
	const { base, cleanup } = tmpBase();
	try {
		await assert.rejects(
			withMaintenanceLock(base, async () => { throw new Error("boom"); }),
			/boom/,
		);
		assert.deepEqual(fs.readdirSync(base), []);
		const r = await withMaintenanceLock(base, async () => "ok");
		assert.equal(r.result, "ok");
		assert.equal(r.releaseWarning, null);
	} finally { cleanup(); }
});

test("维护锁不靠租约年龄判死：新鲜 mtime 的活锁照样 BUSY", () => {
	const { base, cleanup } = tmpBase();
	try {
		const lock = acquireMaintenanceLock(base);
		// 把 mtime 拨到很久以前 —— 按「太老就能抢」的实现这里会被抢走
		const old = new Date(Date.now() - 24 * 3600 * 1000);
		fs.utimesSync(path.join(base, "maintenance.lock"), old, old);
		fs.utimesSync(path.join(base, "maintenance.guard"), old, old);
		assert.throws(() => acquireMaintenanceLock(base), (e) => e.code === MAINTENANCE_ERRORS.BUSY);
		lock.release();
	} finally { cleanup(); }
});
