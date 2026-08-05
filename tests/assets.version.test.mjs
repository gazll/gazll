import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stampAssets } from '../tools/stamp-assets.mjs';

test('a deploy stamps HTML, the complete local module graph and version metadata with one commit id', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gazl-assets-'));
  const publicRoot = path.join(directory, 'public');
  await mkdir(path.join(publicRoot, 'lib'), { recursive: true });
  await writeFile(path.join(publicRoot, 'index.html'),
    '<link rel="stylesheet" href="styles.css"><script type="module" src="boot.js"></script>');
  await writeFile(path.join(publicRoot, 'boot.js'), "import('./app.js');\n");
  await writeFile(path.join(publicRoot, 'app.js'),
    "import { value } from './lib/value.js';\nimport('./lazy.js');\nimport('https://example.com/remote.js');\n");
  await writeFile(path.join(publicRoot, 'lib/value.js'), "export const value = 1;\n");
  await writeFile(path.join(publicRoot, 'lazy.js'), "export default 1;\n");

  try {
    const revision = '1234567890abcdef1234567890abcdef12345678';
    const deployedAt = '2026-08-05T10:00:00.000Z';
    const version = await stampAssets({ publicRoot, revision, deployedAt });
    assert.equal(version, '1234567890ab');

    const html = await readFile(path.join(publicRoot, 'index.html'), 'utf8');
    const boot = await readFile(path.join(publicRoot, 'boot.js'), 'utf8');
    const app = await readFile(path.join(publicRoot, 'app.js'), 'utf8');
    const release = JSON.parse(await readFile(path.join(publicRoot, 'version.json'), 'utf8'));
    assert.match(html, /styles\.css\?v=1234567890ab/);
    assert.match(html, /boot\.js\?v=1234567890ab/);
    assert.match(boot, /app\.js\?v=1234567890ab/);
    assert.match(app, /\.\/lib\/value\.js\?v=1234567890ab/);
    assert.match(app, /\.\/lazy\.js\?v=1234567890ab/);
    assert.match(app, /https:\/\/example\.com\/remote\.js/);
    assert.doesNotMatch(app, /example\.com\/remote\.js\?v=/);
    assert.deepEqual(release, { version, revision, deployed_at: deployedAt });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the browser bootstrap resolves the release without cache before loading CSS and app.js', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const boot = await readFile(path.join(root, 'public/boot.js'), 'utf8');
  const index = await readFile(path.join(root, 'public/index.html'), 'utf8');
  const workflow = await readFile(path.join(root, '.github/workflows/deploy.yml'), 'utf8');

  assert.match(boot, /version\.json/);
  assert.match(boot, /cache:\s*'no-store'/);
  assert.match(boot, /styles\.css/);
  assert.match(boot, /app\.js/);
  assert.match(index, /data-app-styles/);
  assert.match(index, /src="boot\.js(?:\?v=[^"]+)?"/);
  assert.match(workflow, /node tools\/stamp-assets\.mjs "\$GAZL_DEPLOY_SHA"/);

  const testsAt = workflow.indexOf('- name: Run regression tests');
  const stampAt = workflow.indexOf('- name: Stamp deploy version');
  const uploadAt = workflow.indexOf('- uses: actions/upload-pages-artifact@v5');
  assert.ok(testsAt < stampAt, 'deploy assets must be stamped after source regression tests');
  assert.ok(stampAt < uploadAt, 'deploy assets must be stamped before the Pages upload');
});
