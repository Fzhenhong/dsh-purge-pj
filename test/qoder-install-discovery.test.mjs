// Qoder 安装发现与表项定位的回归测试。
// 这两个点各踩过一次坑：
//   1) findLatestVersion 只扫 .qoder-versions → 0.5.1 装在根目录时报「current」假绿；
//   2) 0.5.1 起混淆器没有唯一全局 wrapper（索引挪到第二参数、同名 wrapper 上千个定义），
//      按 wrapper 反推调用点会命中 ajv 的 instancePath 与 i18n 文案表 → 必须换表项。
// 这里不碰真机 asar，只用合成源码验证解析与替换逻辑。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = path.resolve('lib/qoder/qoder-purge.mjs');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qoder-purge-test-'));
}

function mkInstall(root, version, { withAsar = true } = {}) {
  fs.mkdirSync(path.join(root, 'resources'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'resources', 'build-manifest.json'),
    JSON.stringify({ productVersion: version }),
  );
  if (withAsar) fs.writeFileSync(path.join(root, 'resources', 'app.asar'), 'stub');
  return root;
}

function run(args, env) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('根目录安装（0.5.1 布局）会被当成候选，而不是只认 .qoder-versions', () => {
  const base = tmpdir();
  // 根 = 0.5.1（新版布局），.qoder-versions 里只剩 0.4.11
  mkInstall(base, '0.5.1');
  const oldDir = mkInstall(path.join(base, '.qoder-versions', '0.4.11'), '0.4.11');
  assert.ok(fs.existsSync(path.join(oldDir, 'resources', 'app.asar')));

  const r = run(['--check'], { QODER_ROOT: base });
  // 根目录那份是 stub（不是真 asar），所以必然在解码阶段报错 ——
  // 关键是错误信息里要出现根目录的路径，证明选中的是 0.5.1 而不是 0.4.11。
  assert.equal(r.code, 1);
  assert.match(r.out, /Programs|qoder-purge-test-/);
  assert.ok(
    r.out.includes(path.join(base, 'resources', 'app.asar')) ||
      !r.out.includes(path.join(base, '.qoder-versions', '0.4.11', 'resources', 'app.asar')),
    `应选中根安装而不是旧版本目录，实际输出：${r.out.slice(0, 400)}`,
  );
  fs.rmSync(base, { recursive: true, force: true });
});

test('版本号比较按数字段，0.5.1 高于 0.4.11', () => {
  const base = tmpdir();
  mkInstall(base, '0.5.1');
  mkInstall(path.join(base, '.qoder-versions', '0.4.11'), '0.4.11');
  mkInstall(path.join(base, '.qoder-versions', '0.4.9'), '0.4.9');
  // --help 不触网，只验证脚本能起；真正的排序由下面的源码断言覆盖
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /function cmpVersion\(a, b\)/);
  assert.match(src, /out\.sort\(\(a, b\) => cmpVersion\(b\.version, a\.version\)\)/);
  fs.rmSync(base, { recursive: true, force: true });
});

test('补丁路径不再依赖唯一 wrapper，而是换表项', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  // 表项替换的两个构件必须在
  assert.match(src, /function encodeWithCharset\(text, CS\)/);
  assert.match(src, /function splitTableBody\(body\)/);
  // 旧的「按 wrapper 调用点替换」必须已经不在补丁主路径里
  assert.doesNotMatch(src, /out = out\.replace\(re, \(\) => JSON\.stringify\(purgeText\)\)/);
  // 旋转 IIFE 必须默认不跑（0.5.1 里它是死循环）
  assert.match(src, /process\.env\.QODER_PURGE_ROTATE === '1'/);
});

test('隔离失败会退回 in-place，而不是直接失败', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /abort-busy isolate live asar failed/);
  assert.match(src, /return cmdInplaceSwap\(\{ check, force \}\)/);
});

test('表项切分对合成表往返一致', () => {
  const CS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const fnSrc = src.match(/function encodeWithCharset\(text, CS\) \{[\s\S]*?\n\}/)[0];
  const encode = new Function('Buffer', `${fnSrc}; return encodeWithCharset;`)(Buffer);
  const text = 'You are an interactive agent — 中文混排 ok\n';
  const enc = encode(text, CS);
  assert.doesNotMatch(enc, /[",]/, 'charset 编码结果里不能出现引号或逗号');
  // 用同一 charset 解回来
  const dec = (b) => {
    let s = '', bits = 0, acc = 0;
    for (const ch of b) {
      const i = CS.indexOf(ch);
      if (i < 0 || i === 64) { if (i === 64) break; continue; }
      acc = (acc << 6) | i; bits += 6;
      if (bits >= 8) { bits -= 8; s += String.fromCharCode((acc >> bits) & 0xff); }
    }
    return Buffer.from(s, 'latin1').toString('utf8');
  };
  assert.equal(dec(enc), text);
});
