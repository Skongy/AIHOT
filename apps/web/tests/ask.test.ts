import assert from "node:assert/strict";
import { createServer } from "node:http";
import { before, after, test } from "node:test";
import { chromium, webkit, expect, type Browser, type Page } from "@playwright/test";
import { startWebServer, type WebServer } from "./web-server.ts";

let web: WebServer; let browser: Browser; let phoneBrowser: Browser;
let enabled = true; let submissions = 0; let failOnce = false; let expiredOnce = false; let hold = false;
let activeTask: any = null; let savedMessages: any[] = []; let lastRequest: any; let sessionCreates = 0;
let sseResponse: import("node:http").ServerResponse | null = null;
const at = "2026-10-16T08:00:00Z";
const evidence = [{ id: 1, kind: "item", title: "无畏契约版本更新", siteUrl: "/items/ask-fixture", originalUrl: "https://example.org/news", sourceName: "测试媒体", publishedAt: at }];
const answer = "## 重点\n**这次有一项版本更新。** [1]\n\n- 地图发生变化。[1]\n- 未提供的数据不能确认。\n\n[伪造链接](https://evil.test/items/ask-fixture)\n<img src=x onerror=alert(1)>";
let nextAnswer = answer; let nextStatus = "completed"; let useDeepReport = false;
const deepMarkdown = "# 《无畏契约》测试服什么时候开启？\n\n## 核心结论\n- 官方确认测试服将于 5 月 20 日开启 [1]\n";
const deepPlan = { version: 1, steps: [{ index: 0, goal: "检索报道", tool: "search", toolLabel: "检索", status: "done", dependsOn: [], summary: "收集到 1 条可引用资料" }] };
const deepReport = { summary: ["官方确认测试服将于 5 月 20 日开启 [1]"], timeline: [{ at: "2026-05-01T02:00:00.000Z", title: "无畏契约更新公告", evidenceId: 1, sourceType: "官方来源" }], coverage: { official: 1, media: 1, unknown: 0 }, comparison: [{ text: "官方确认冠军皮肤将在下月推出", evidenceIds: [2] }], heat: [{ label: "热榜名次", value: "4", evidenceId: 1 }], chart: null, uncertainty: [{ status: "disputed", text: "官方确认冠军皮肤将在下月推出", note: "结论写成了官方表态，但所引证据没有官方来源。", evidenceIds: [2] }], citations: [{ id: 1, title: "无畏契约更新公告", sourceName: "拳头游戏", sourceType: "官方来源", siteUrl: "/items/ask-fixture", publishedAt: "2026-05-01T02:00:00.000Z" }, { id: 2, title: "媒体猜测冠军皮肤", sourceName: "游戏媒体", sourceType: "媒体报道", siteUrl: "/items/media-fixture", publishedAt: "2026-05-03T08:00:00.000Z" }] };
function event(type: string, payload: any, seq: number) { return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({payload})}\n\n`; }
function complete() {
  if (!activeTask) return;
  const steps = [
    {type:'step_start',payload:{stepId:'search-1',tool:'search',labelZh:'检索站内资料'}},
    {type:'step_end',payload:{stepId:'search-1',ok:true,summary:'找到相关报道'}},
  ];
  if (useDeepReport) {
    activeTask = {...activeTask,mode:'deep',status:'completed',finalAnswer:deepMarkdown,evidence,steps,research:[{type:'research_plan',payload:deepPlan},{type:'research_report',payload:{report:deepReport}}],snapshotSeq:6};
    savedMessages.push({id:'answer-'+activeTask.taskId,role:'assistant',taskId:activeTask.taskId,content:deepMarkdown});
    sseResponse?.write(event('research_report',{report:deepReport},2));
    sseResponse?.write(event('answer_done',{text:deepMarkdown},3));
    sseResponse?.end(event('task_status',{status:'completed'},6)); sseResponse=null;
    return;
  }
  activeTask = {...activeTask,status:nextStatus,finalAnswer:nextAnswer,evidence,steps,snapshotSeq:7};
  savedMessages.push({id:'answer-'+activeTask.taskId,role:'assistant',taskId:activeTask.taskId,content:nextAnswer});
  sseResponse?.write(event('step_start',steps[0].payload,2));
  sseResponse?.write(event('step_end',steps[1].payload,3));
  sseResponse?.write(event('evidence',{items:evidence},4));
  sseResponse?.write(event('answer_delta',{text:nextAnswer},5));
  sseResponse?.write(event('answer_done',{text:nextAnswer},6));
  sseResponse?.end(event('task_status',{status:nextStatus},7)); sseResponse=null;
}
const api=createServer(async(req,res)=>{
  const url=new URL(req.url!,'http://local'); const p=url.pathname;
  res.setHeader('content-type','application/json');
  if(p==='/api/site/meta')return res.end(JSON.stringify({changelogVersion:'fixture'}));
  if(p==='/api/site/track'){res.statusCode=204;return res.end();}
  if(p==='/api/ask/capabilities')return res.end(JSON.stringify({available:enabled}));
  if(p==='/api/ask/context/ask-fixture')return res.end(JSON.stringify({id:'ask-fixture',title:'无畏契约版本更新',sourceName:'测试媒体'}));
  if(p==='/api/ask/sessions'&&req.method==='POST'){sessionCreates++;return res.end(JSON.stringify({sessionId:'ask-session'}));}
  if(p==='/api/ask/sessions/ask-session'&&req.method==='GET')return res.end(JSON.stringify({messages:savedMessages,recentTasks:activeTask?[{id:activeTask.taskId,status:activeTask.status}]:[]}));
  if(p.endsWith('/messages')&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    const request=JSON.parse(body); submissions++;lastRequest=request;
    if(expiredOnce){expiredOnce=false;res.statusCode=404;return res.end(JSON.stringify({detail:'会话已过期'}));}
    if(failOnce){failOnce=false;res.statusCode=503;return res.end(JSON.stringify({detail:'临时故障'}));}
    if(!activeTask||activeTask.requestId!==request.clientRequestId){
      activeTask={taskId:'task-'+submissions,requestId:request.clientRequestId,status:'running',mode:request.mode==='deep'?'deep':'normal',draftAnswer:'',finalAnswer:null,evidence:[],steps:[],research:useDeepReport?[{type:'research_plan',payload:deepPlan}]:[],snapshotSeq:useDeepReport?1:0};
      savedMessages.push({id:'user-'+submissions,role:'user',content:request.message,taskId:activeTask.taskId});
    }
    return res.end(JSON.stringify({taskId:activeTask.taskId,status:activeTask.status}));
  }
  if(p.endsWith('/cancel')){
    activeTask.status='cancelled'; sseResponse?.end(event('task_status',{status:'cancelled'},6));sseResponse=null;return res.end('{}');
  }
  if(p.endsWith('/events')){
    res.setHeader('content-type','text/event-stream');res.setHeader('cache-control','no-cache');res.flushHeaders();
    sseResponse=res;
    res.write(event('task_status',{status:'running'},1));
    if(!hold)complete();return;
  }
  if(p.startsWith('/api/ask/tasks/')&&activeTask)return res.end(JSON.stringify(activeTask));
  res.statusCode=404;res.end(JSON.stringify({detail:'不存在'}));
});
before(async()=>{
  web=await startWebServer(api);
  browser=await chromium.launch(process.env.ASK_TEST_CHROME_PATH?{executablePath:process.env.ASK_TEST_CHROME_PATH}:{channel:'chromium'});
  phoneBrowser=process.env.ASK_TEST_CHROME_PATH?browser:await webkit.launch();
});
after(async()=>{sseResponse?.end();if(phoneBrowser&&phoneBrowser!==browser)await phoneBrowser.close();await browser?.close();await web?.stop();});
async function visit(options:{phone?:boolean;dark?:boolean;article?:boolean;standalone?:boolean}={}){
  enabled=true;submissions=0;failOnce=false;expiredOnce=false;hold=false;activeTask=null;savedMessages=[];sseResponse=null;sessionCreates=0;nextAnswer=answer;nextStatus='completed';useDeepReport=false;
  const context=await(options.phone?phoneBrowser:browser).newContext({viewport:options.phone?{width:390,height:844}:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.addInitScript(({dark,standalone})=>{sessionStorage.setItem('gamehot-intro-seen-v1','1');localStorage.setItem('aihot-theme',dark?'dark':'light');if(standalone)Object.defineProperty(navigator,'standalone',{value:true});},{dark:!!options.dark,standalone:!!options.standalone});
  const page=await context.newPage();
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(web.origin+'/ask'+(options.article?'?article=ask-fixture':''));
  await expect(page.getByText('游戏圈的消息，')).toBeVisible();
  await expect(page.getByText('正在恢复对话…')).toHaveCount(0);
  return {context,page,errors};
}
async function send(page:Page,text='最近有哪些资讯？'){
  await page.getByLabel('你的游戏资讯问题').fill(text);
  await expect(page.getByRole('button',{name:'发送问题',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'发送问题',exact:true}).click();
}
test('three starters only fill the composer; page visits do not create tasks',async()=>{
  const {context,page,errors}=await visit();try{
    await page.getByRole('button',{name:/追踪游戏/}).click();
    await expect(page.getByLabel('你的游戏资讯问题')).toHaveValue(/无畏契约/);
    assert.equal(submissions,0);assert.equal(sessionCreates,0);assert.deepEqual(errors,[]);
    if(process.env.ASK_REVIEW_DIR)await page.screenshot({path:process.env.ASK_REVIEW_DIR+'/desktop.png',fullPage:true});
  }finally{await context.close();}
});
test('Chinese IME Enter never sends; Shift+Enter adds a line; deliberate Enter sends once',async()=>{
  const {context,page}=await visit();try{
    const input=page.getByLabel('你的游戏资讯问题');await input.fill('游戏');
    await input.dispatchEvent('compositionstart');await input.press('Enter');assert.equal(submissions,0);
    await input.dispatchEvent('compositionend');await input.press('Shift+Enter');assert.equal(submissions,0);
    await input.press('Enter');await expect(page.getByRole('heading',{name:'重点',exact:true})).toBeVisible();assert.equal(submissions,1);
  }finally{await context.close();}
});
test('answers render safe typography, numbered citations open matching sources, refresh keeps them',async()=>{
  const {context,page,errors}=await visit();try{
    await send(page);await expect(page.getByRole('heading',{name:'重点',exact:true})).toBeVisible();
    const progressButton=page.getByRole('button',{name:/资料整理完成/});
    await expect(progressButton).toBeVisible();await expect(progressButton).toHaveAttribute('aria-expanded','false',{timeout:3000});
    await progressButton.click();await expect(progressButton).toHaveAttribute('aria-expanded','true');
    await expect(page.getByText('找到相关报道',{exact:true})).toBeVisible();
    await expect(page.locator('.ask-answer strong')).toHaveText('这次有一项版本更新。');
    await expect(page.locator('.ask-answer img')).toHaveCount(0);await expect(page.locator('a[href*="evil.test"]')).toHaveCount(0);
    await page.getByRole('button',{name:'查看来源 1：无畏契约版本更新'}).first().click();
    await expect(page.locator('.ask-sources')).toHaveAttribute('open','');
    await expect(page.getByText('2026/10/16',{exact:true})).toBeVisible();
    await page.reload();await expect(page.getByRole('button',{name:'查看来源 1：无畏契约版本更新'}).first()).toBeVisible();
    assert.equal(submissions,1);assert.deepEqual(errors,[]);
    if(process.env.ASK_REVIEW_DIR)await page.screenshot({path:process.env.ASK_REVIEW_DIR+'/answer.png',fullPage:true});
  }finally{await context.close();}
});
test('pipe tables render as readable tables and uncited retrieved reports stay available in degraded answers',async()=>{
  const {context,page,errors}=await visit();try{
    nextAnswer='## 当前热点\n\n| 排名 | 事件 | 核心动态 |\n|:---|:---|:---|\n| 1 | 街头霸王电影 | 首周末票房表现 |\n| 2 | 手柄专利 | 新专利申请 |';nextStatus='completed_degraded';
    await send(page,'最近有哪些游戏热点？');
    await expect(page.locator('.ask-answer table')).toBeVisible();
    await expect(page.locator('.ask-answer tbody tr')).toHaveCount(2);
    await expect(page.getByText('街头霸王电影',{exact:true})).toBeVisible();
    await expect(page.getByText(/未能把所有内容关联到具体新闻/)).toBeVisible();
    await expect(page.locator('.ask-sources summary')).toContainText('本次检索到的资料');
    await expect(page.locator('.ask-sources')).toContainText('回答未能逐条匹配到具体来源');
    await expect(page.locator('.ask-sources a[href="https://example.org/news"]')).toHaveText('查看原文 ↗');
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('retry preserves request id and restores accepted task rather than submitting a duplicate',async()=>{
  const {context,page}=await visit();try{
    failOnce=true;await send(page);await expect(page.getByRole('button',{name:'重试发送'})).toBeVisible();
    const id=lastRequest.clientRequestId;await page.getByRole('button',{name:'重试发送'}).click();
    await expect(page.getByRole('heading',{name:'重点',exact:true})).toBeVisible();assert.equal(lastRequest.clientRequestId,id);
    await expect(page.locator('.ask-user')).toHaveCount(1);
  }finally{await context.close();}
});
test('expired sessions renew automatically and article context is sent only on submit',async()=>{
  const {context,page}=await visit({article:true});try{
    await expect(page.getByText('无畏契约版本更新',{exact:true})).toBeVisible();assert.equal(submissions,0);
    expiredOnce=true;await send(page,'这篇说了什么？');
    await expect(page.getByRole('heading',{name:'重点',exact:true})).toBeVisible();
    assert.match(lastRequest.message,/关于这篇站内资讯：\/items\/ask-fixture/);assert.equal(sessionCreates,2);
  }finally{await context.close();}
});
test('mobile layout fits, drafting stays available while generating and stop terminates the stream',async()=>{
  const {context,page,errors}=await visit({phone:true});try{
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const intro=await page.locator('.ask-intro').boundingBox();const composer=await page.locator('.ask-composer').boundingBox();
    assert.ok(intro&&composer&&intro.y+intro.height<=composer.y,'composer must not cover the introduction');
    if(process.env.ASK_REVIEW_DIR)await page.screenshot({path:process.env.ASK_REVIEW_DIR+'/phone.png',fullPage:true});
    hold=true;await send(page);await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible();
    await page.getByLabel('你的游戏资讯问题').fill('下一条问题');await page.getByRole('button',{name:'停止生成'}).click();
    await expect(page.getByRole('button',{name:'发送问题',exact:true})).toBeEnabled();
    await expect(page.getByLabel('你的游戏资讯问题')).toHaveValue('下一条问题');assert.equal(activeTask.status,'cancelled');assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('scrolling up during a long streamed answer keeps the reading position',async()=>{
  const {context,page}=await visit();try{
    const viewport=page.locator('.ask-scroll');const composer=page.locator('.ask-composer-area');
    const initial=await composer.boundingBox();assert.ok(initial);
    hold=true;await send(page);await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible();
    await expect.poll(()=>!!sseResponse).toBe(true);
    const text=Array.from({length:60},(_,i)=>`段落 ${i}：这是用于滚动行为检查的固定说明。\n\n`).join('');
    sseResponse!.write(event('answer_delta',{text},2));
    await expect(page.locator('.ask-answer')).toContainText('段落 59');
    await expect.poll(()=>viewport.evaluate(el=>el.scrollTop)).toBeGreaterThan(200);
    await viewport.hover();await page.mouse.wheel(0,-10000);await expect.poll(()=>viewport.evaluate(el=>el.scrollTop)).toBe(0);
    const y=await viewport.evaluate(el=>el.scrollTop);
    sseResponse!.write(event('answer_delta',{text:'\n新到达的一段内容。'},3));
    await expect(page.locator('.ask-answer')).toContainText('新到达的一段内容');
    assert.ok(Math.abs((await viewport.evaluate(el=>el.scrollTop))-y)<1);
    const current=await composer.boundingBox();assert.ok(current);assert.ok(Math.abs(current.y-initial.y)<1);
    assert.equal(await page.evaluate(()=>scrollY),0);
    await expect(page.getByRole('button',{name:'回到最新回答 ↓'})).toBeVisible();
    await page.getByRole('button',{name:'停止生成'}).click();
  }finally{await context.close();}
});
for(const phone of [false,true])test(`${phone?'phone':'desktop'} composer stays docked and small upward scrolls pause streaming until returning to latest`,async()=>{
  const {context,page}=await visit({phone});try{
    const viewport=page.locator('.ask-scroll');const composer=page.locator('.ask-composer-area');
    const original=await composer.boundingBox();assert.ok(original);
    const windowHeight=page.viewportSize()!.height;
    assert.ok(Math.abs(original.y+original.height-(windowHeight-(phone?50:0)))<2);
    hold=true;await send(page);await expect.poll(()=>!!sseResponse).toBe(true);
    sseResponse!.write(event('answer_delta',{text:Array.from({length:45},(_,i)=>`正文 ${i}：固定测试段落，用来模拟持续到达的长回答。\n\n`).join('')},2));
    await expect(page.locator('.ask-answer')).toContainText('正文 44');
    await expect.poll(()=>viewport.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(1);
    await viewport.hover();const before=await viewport.evaluate(el=>el.scrollTop);
    await page.mouse.wheel(0,-2);await expect.poll(()=>viewport.evaluate(el=>el.scrollTop)).toBeLessThan(before-.5);
    const paused=await viewport.evaluate(el=>el.scrollTop);
    for(let i=0;i<2;i++){
      sseResponse!.write(event('answer_delta',{text:`\n增量 ${i}：${'新内容继续到达。'.repeat(90)}\n`},3+i));
      await expect(page.locator('.ask-answer')).toContainText(`增量 ${i}`);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.ok(Math.abs((await viewport.evaluate(el=>el.scrollTop))-paused)<1,'streaming must not pull the reader back down');
      const dock=await composer.boundingBox();assert.ok(dock);assert.ok(Math.abs(dock.y-original.y)<1);
      assert.equal(await page.evaluate(()=>scrollY),0);
    }
    await page.getByRole('button',{name:'回到最新回答 ↓'}).click();
    await expect.poll(()=>viewport.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(1);
    await page.getByLabel('你的游戏资讯问题').fill('下一条问题\n'.repeat(7));
    const expanded=await composer.boundingBox();assert.ok(expanded);assert.ok(Math.abs(expanded.y+expanded.height-(original.y+original.height))<1,'growing the input must preserve its bottom edge');
    assert.ok(await viewport.evaluate(el=>el.getBoundingClientRect().bottom)<=expanded.y+1,'the input must not overlap the answer pane');
    await page.getByLabel('你的游戏资讯问题').fill('下一条问题');
    sseResponse!.write(event('answer_delta',{text:'\n恢复跟随后的新段落。\n'},5));
    await expect(page.locator('.ask-answer')).toContainText('恢复跟随后的新段落');
    await expect.poll(()=>viewport.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(1);
    await page.getByRole('button',{name:'停止生成'}).click();
  }finally{await context.close();}
});
test('standalone phone conversations retain downward touch gestures instead of triggering page refresh',async()=>{
  const {context,page}=await visit({phone:true,standalone:true});try{
    await page.getByLabel('你的游戏资讯问题').fill('测试草稿');
    await expect(page.getByRole('button',{name:'发送问题',exact:true})).toBeEnabled();
    const prevented=await page.locator('.ask-scroll').evaluate(el=>{
      const touch=(type:string,y:number)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'touches',{value:[{clientX:150,clientY:y}]});el.dispatchEvent(event);return event.defaultPrevented;};
      touch('touchstart',100);const prevented=touch('touchmove',300);el.dispatchEvent(new Event('touchcancel',{bubbles:true}));return prevented;
    });
    assert.equal(prevented,false);assert.equal(submissions,0);
    await expect(page.getByLabel('你的游戏资讯问题')).toHaveValue('测试草稿');
  }finally{await context.close();}
});
test('interrupted event streams reconnect without creating another task',async()=>{
  const {context,page}=await visit();try{
    hold=true;await send(page);await expect.poll(()=>!!sseResponse).toBe(true);
    sseResponse!.destroy();sseResponse=null;
    await expect(page.getByText(/连接中断，正在恢复/)).toBeVisible();
    hold=false;
    await expect(page.getByRole('heading',{name:'重点',exact:true})).toBeVisible({timeout:15000});
    assert.equal(submissions,1);await expect(page.locator('.ask-user')).toHaveCount(1);
  }finally{await context.close();}
});
test('a deep report shows verified sections and refuses a one-point chart',async()=>{
  const {context,page,errors}=await visit();try{
    await page.getByRole('radio',{name:'深度研究'}).click();
    assert.equal(submissions,0);
    useDeepReport=true;
    await send(page,'《无畏契约》测试服什么时候开启？');
    await expect(page.getByRole('heading',{name:'核心结论'})).toBeVisible();
    await expect(page.getByText('官方确认测试服将于 5 月 20 日开启 [1]')).toBeVisible();
    await expect(page.getByText('无畏契约更新公告').first()).toBeVisible();
    await expect(page.getByText('存在争议')).toBeVisible();
    await expect(page.getByText('不能据此断言热度变化的原因。')).toBeVisible();
    await expect(page.locator('.ask-report-chart')).toHaveCount(0);
    await page.locator('.ask-report-citations summary').first().click();
    await expect(page.getByRole('link',{name:'查看来源'})).toHaveAttribute('href','/items/ask-fixture');
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    await page.getByRole('button',{name:'复制回答'}).click();
    await expect(page.getByRole('button',{name:'已复制'})).toBeVisible();
    assert.match(await page.evaluate(()=>navigator.clipboard.readText()), /# 《无畏契约》测试服什么时候开启？/);
    const motion=await page.locator('.ask-report').evaluate((el)=>getComputedStyle(el).transitionDuration);
    assert.equal(motion,'0s');
    await page.reload();
    await expect(page.getByRole('heading',{name:'核心结论'})).toBeVisible();
    assert.equal(lastRequest.mode,'deep');
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('the same deep report fits a phone and stays readable in dark mode',async()=>{
  const {context,page,errors}=await visit({phone:true,dark:true});try{
    useDeepReport=true;
    await page.getByRole('radio',{name:'深度研究'}).click();
    await send(page,'《无畏契约》测试服什么时候开启？');
    await expect(page.getByRole('heading',{name:'核心结论'})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
    await expect(page.locator('.ask-report-timeline li')).toBeVisible();
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('disabled model service is announced before submitting and dark theme remains usable',async()=>{
  const {context,page}=await visit({dark:true});try{
    enabled=false;await page.reload();await expect(page.getByText(/问答暂未开放/)).toBeVisible();
    await page.getByLabel('你的游戏资讯问题').fill('游戏资讯');await expect(page.getByRole('button',{name:'发送问题',exact:true})).toBeDisabled();
    assert.equal(submissions,0);
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    if(process.env.ASK_REVIEW_DIR)await page.screenshot({path:process.env.ASK_REVIEW_DIR+'/dark.png',fullPage:true});
  }finally{await context.close();}
});
