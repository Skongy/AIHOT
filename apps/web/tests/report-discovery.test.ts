// Production SSR with a local health stub. Failure case: machine entry points for weekly and monthly
// reports exist but cannot be found from the access page.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import * as cheerio from 'cheerio';
import { MCP_TOOL_NAMES, MCP_TOOL_DESCRIPTIONS, MCP_TOOL_DESCRIPTION_TRANSLATIONS, mcpToolName } from '@aihot/contracts/mcp';
import { ASK_PUBLIC_TOOL_DESCRIPTIONS, ASK_PUBLIC_TOOL_DESCRIPTION_TRANSLATIONS } from '../../../modules/ask/tool-descriptions.ts';
import { startWebServer, type WebServer } from './web-server.ts';

let web: WebServer;
const api = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true }));
  if (req.url === '/api/site/meta') return res.end(JSON.stringify({ changelogVersion: '2026-01-01T00:00' }));
  res.statusCode = 404;
  res.end(JSON.stringify({ code: 'not_found' }));
});
before(async () => { web = await startWebServer(api); });
after(() => web.stop());

test('all tool descriptions have both languages, preserve the MCP original and start collapsed', async () => {
  const response = await fetch(`${web.origin}/agent`);
  assert.equal(response.status, 200);
  const $ = cheerio.load(await response.text());
  const expected = new Map(Object.entries(MCP_TOOL_DESCRIPTIONS));
  const translations = new Map(Object.entries(MCP_TOOL_DESCRIPTION_TRANSLATIONS));
  for (const tool of ['get_article','search_news','search_events','get_news_stats','get_attention_trend','explain_selection','explain_hot']) {
    expected.set(mcpToolName(tool), ASK_PUBLIC_TOOL_DESCRIPTIONS[tool]!);
    translations.set(mcpToolName(tool), ASK_PUBLIC_TOOL_DESCRIPTION_TRANSLATIONS[tool]!);
  }
  const buttons = $('#agent-panel table button[aria-controls]');
  assert.equal(buttons.length, expected.size);
  buttons.each((_index, element) => {
    const button = $(element);
    const name = button.find('code').text();
    assert.equal(button.attr('aria-expanded'), 'false');
    const row = $(`[id="${button.attr('aria-controls')}"]`);
    assert.ok(row.is('[hidden]'), name);
    const zh = row.find('p[lang="zh-CN"]').text(), en = row.find('p[lang="en"]').text();
    assert.equal(row.find('p').length, 2, name);
    assert.equal(zh, translations.get(name)?.zh, name);
    assert.equal(en, translations.get(name)?.en, name);
    assert.match(zh, /\p{Script=Han}/u, name);
    assert.match(en, /[a-z]{3}/i, name);
    assert.ok(zh === expected.get(name) || en === expected.get(name), `${name}: original MCP text was lost`);
    assert.equal(row.find('td').attr('colspan'), '3');
  });
});

for (const [tab, names] of [
  ['rss', ['/feed/daily.xml', '/feed/weekly.xml', '/feed/monthly.xml']],
  ['api', ['/api/v1/dailies/latest', '/api/v1/weeklies/latest', '/api/v1/monthlies/latest']],
  ['mcp', [MCP_TOOL_NAMES.daily, MCP_TOOL_NAMES.weekly, MCP_TOOL_NAMES.monthly]],
] as const) {
  test(`the ${tab} panel exposes all report entry points`, async () => {
    const response = await fetch(`${web.origin}/agent?tab=${tab}`);
    assert.equal(response.status, 200, web.logs());
    const panel = cheerio.load(await response.text())('#agent-panel').text();
    for (const name of names) assert.ok(panel.includes(name), `${tab} panel omits ${name}`);
  });
}
