import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requiresChecks } from '../scripts/ci/changes.ts';

test('only documentation is skipped; prompts, legal pages, dependencies and workflows remain checked', () => {
  assert.equal(requiresChecks(['README.md', 'README.en.md', 'docs/design.md']), false);
  for (const file of ['industry/prompts/score.md', 'modules/ask/prompts/system-v1.md', 'site/pages/privacy.md', 'README.js', 'package-lock.json', '.github/workflows/check.yml']) {
    assert.equal(requiresChecks(['docs/readme.md', file]), true, file);
  }
  assert.equal(requiresChecks([]), true);
});

test('the actual PR range includes earlier code even after a docs-only follow-up; dispatch always checks', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-scope-'));
  const script = new URL('../scripts/ci/changes.ts', import.meta.url);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  try {
    git('init'); writeFileSync(path.join(dir, 'README.md'), 'base'); git('add', '.'); git('commit', '-m', 'base'); const base = git('rev-parse','HEAD');
    writeFileSync(path.join(dir, 'README.md'), 'docs'); git('add','.'); git('commit','-m','docs'); const docs = git('rev-parse','HEAD');
    const invoke = (head: string, name = 'pull_request') => {
      const event = path.join(dir, 'event.json'), output = path.join(dir, 'output');
      writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } })); writeFileSync(output,'');
      execFileSync(process.execPath, [fileURLToPath(script)], { cwd: dir, env: { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: name } });
      return readFileSync(output,'utf8');
    };
    assert.equal(invoke(docs), 'code=false\n');
    assert.equal(invoke(docs, 'workflow_dispatch'), 'code=true\n');
    writeFileSync(path.join(dir,'code.ts'),'export const value = 1;'); git('add','code.ts'); git('commit','-m','code');
    writeFileSync(path.join(dir,'README.md'),'follow-up'); git('add','README.md'); git('commit','-m','more docs');
    assert.equal(invoke(git('rev-parse','HEAD')), 'code=true\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('main runs cannot coalesce and all original validation commands remain present', () => {
  const workflow = readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}/);
  assert.match(workflow, /format\('run-\{0\}', github.run_id\)/);
  for (const command of ['--test-global-setup=tests/databases.ts', '--test-shard=${{ matrix.shard }}/3 "tests/*.test.ts" "modules/*/tests/*.test.ts"', 'node --test --test-shard=', 'npm run typecheck', 'scripts/check-migrations.ts', 'scripts/mcp-check.ts', 'scripts/smoke.ts', 'docker compose up -d --build']) assert.ok(workflow.includes(command), command);
  assert.match(workflow, /check:\n    if: always\(\)/);
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.ok(workflow.includes(`mcr.microsoft.com/playwright:v${lock.packages['node_modules/@playwright/test'].version}-noble`), 'browser image must match the locked Playwright version');
});
