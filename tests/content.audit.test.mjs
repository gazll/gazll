import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const audit = path.join(root, 'tools', 'audit-content.mjs');

function runAudit(flag) {
  const result = spawnSync(process.execPath, [audit, flag], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || `audit exited ${result.status}`);
  return result.stdout;
}

test('--gaps treats tables and figures as explanatory evidence', () => {
  const output = runAudit('--gaps');
  assert.doesNotMatch(
    output,
    /15-network-i-o-models\.threading-network-programming\.q6/,
    'the HTTP lifecycle already has a detailed figure and must not be ranked as an unillustrated gap'
  );
});

test('--stale recognizes high-change standards and tools beyond the original product list', () => {
  const output = runAudit('--stale');
  assert.match(
    output,
    /13-security-oauth2\.oauth2-oidc\.q2[\s\S]*?OAuth 2\.1/,
    'OAuth 2.1 must be reviewable even though it is not Java/Spring/database software'
  );
  assert.match(
    output,
    /21-linux-production-debug\.jvm-network-deep-dive-on-prod\.q3[\s\S]*?async-profiler/i,
    'async-profiler guidance changes independently of the Java version mentioned in the same item'
  );
});

test('--refs always reports whether unvalidated chapter aliases remain', () => {
  const output = runAudit('--refs');
  assert.match(output, /non-canonical chapter references/i);
  assert.match(output, /25-microservice|none/i);
});

