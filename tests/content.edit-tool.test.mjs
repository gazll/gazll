import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tool = path.join(root, 'tools', 'add-content.mjs');

test('content patch tool can replace a whole answer and question in dry-run mode', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'content-patch-'));
  const patchPath = path.join(dir, 'replace.patch');
  await writeFile(patchPath, [
    '@@ answer 01-java-core-jvm.concurrency.q1 en',
    'Replacement answer used only in memory.',
    '',
    '@@ question 01-java-core-jvm.concurrency.q1 vi',
    'Câu hỏi thay thế chỉ dùng trong bộ nhớ.',
    ''
  ].join('\n'), 'utf8');

  try {
    const result = spawnSync(process.execPath, [tool, patchPath, '--dry-run'], {
      cwd: root,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /mode=answer/);
    assert.match(result.stdout, /mode=question/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
