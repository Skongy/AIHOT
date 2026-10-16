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
function event(type: string, payload: any, seq: number) { return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({payload})}\n\n`; }
function complete() {
  if (!activeTask) return;
  activeTask = {...activeTask,status:'completed',finalAnswer:answer,evidence, snapshotSeq:5};
  savedMessages.push({id:'answer-'+activeTask.taskId,role:'assistant',taskId:activeTask.taskId,content:answer});
  sseResponse?.write(event('evidence',{items:evidence},2));
  sseResponse?.write(event('answer_delta',{text:answer},3));
  sseResponse?.write(event('answer_done',{text:answer},4));
  sseResponse?.end(event('task_status',{status:'completed'},5)); sseResponse=null;
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
      activeTask={taskId:'task-'+submissions,requestId:request.clientRequestId,status:'running',draftAnswer:'',finalAnswer:null,evidence:[],steps:[],snapshotSeq:0};
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
async function visit(options:{phone?:boolean;dark?:boolean;article?:boolean}={}){
  enabled=true;submissions=0;failOnce=false;expiredOnce=false;hold=false;activeTask=null;savedMessages=[];sseResponse=null;sessionCreates=0;
  const context=await(options.phone?phoneBrowser:browser).newContext({viewport:options.phone?{width:390,height:844}:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.addInitScript((dark)=>{sessionStorage.setItem('gamehot-intro-seen-v1','1');if(dark)localStorage.setItem('theme','dark');},!!options.dark);
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
    hold=true;await send(page);await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible();
    await expect.poll(()=>!!sseResponse).toBe(true);
    const text=Array.from({length:60},(_,i)=>`段落 ${i}：这是用于滚动行为检查的固定说明。\n\n`).join('');
    sseResponse!.write(event('answer_delta',{text},2));
    await expect(page.locator('.ask-answer')).toContainText('段落 59');
    await page.mouse.wheel(0,-10000);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeLessThan(200);
    const y=await page.evaluate(()=>scrollY);
    sseResponse!.write(event('answer_delta',{text:'\n新到达的一段内容。'},3));
    await expect(page.locator('.ask-answer')).toContainText('新到达的一段内容');
    assert.ok(Math.abs((await page.evaluate(()=>scrollY))-y)<20);
    await expect(page.getByRole('button',{name:'回到最新回答 ↓'})).toBeVisible();
    await page.getByRole('button',{name:'停止生成'}).click();
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
test('disabled model service is announced before submitting and dark theme remains usable',async()=>{
  const {context,page}=await visit({dark:true});try{
    enabled=false;await page.reload();await expect(page.getByText(/问答暂未开放/)).toBeVisible();
    await page.getByLabel('你的游戏资讯问题').fill('游戏资讯');await expect(page.getByRole('button',{name:'发送问题',exact:true})).toBeDisabled();
    assert.equal(submissions,0);
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    if(process.env.ASK_REVIEW_DIR)await page.screenshot({path:process.env.ASK_REVIEW_DIR+'/dark.png',fullPage:true});
  }finally{await context.close();}
});
