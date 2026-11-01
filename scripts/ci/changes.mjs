// Only explicit documentation locations bypass validation; prompt Markdown stays runtime input.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const isDocumentation = path => /^(?:README(?:\.[^/]+)?\.md|README(?:\.txt|\.rst)?)$/.test(path)
  || path.startsWith('docs/') || path.startsWith('.github/ISSUE_TEMPLATE/')
  || path === '.github/pull_request_template.md';

export function requiresChecks(paths) {
  return paths.length === 0 || paths.some(path => !isDocumentation(path));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let code = true;
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    const base = event.pull_request?.base.sha ?? event.before;
    const head = event.pull_request?.head.sha ?? event.after;
    if (base && head && !/^0+$/.test(base)) {
      const range = event.pull_request ? `${base}...${head}` : `${base}..${head}`;
      const paths = execFileSync('git', ['diff', '--name-only', '-z', range], { encoding: 'utf8' }).split('\0').filter(Boolean);
      code = requiresChecks(paths);
      console.log(`${paths.length} changed paths; ${code ? 'full validation' : 'documentation only'}`);
    }
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `code=${code}\n`);
}
