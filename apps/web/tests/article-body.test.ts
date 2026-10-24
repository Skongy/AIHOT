import assert from "node:assert/strict";
import {createServer} from "node:http";
import {before,after,test} from "node:test";
import {chromium,expect,type Browser} from "@playwright/test";
import type {SiteItemDetail} from "@aihot/contracts/site";
import {startWebServer,type WebServer} from "./web-server.ts";

const api=createServer((req,res)=>{
  const path=new URL(req.url!,"http://fixture").pathname;
  res.setHeader("content-type","application/json");
  if(path==="/api/site/meta")return res.end(JSON.stringify({changelogVersion:null}));
  if(path==="/api/site/track"){res.statusCode=204;return res.end();}
  const mode=/^\/api\/site\/items\/(body|missing|restricted|policy|pending)-fixture$/.exec(path)?.[1];
  if(mode){
    const item:SiteItemDetail={id:mode+"-fixture",title:"新闻正文展示检查",originalTitle:null,summary:"这是固定的 AI 导读，与新闻原文分开展示。",reason:null,source:{name:"测试来源"},links:{original:"https://example.org/original-article"},publishedAt:"2026-10-17T00:00:00Z",discoveredAt:"2026-10-17T00:00:00Z",timelineAt:"2026-10-17T00:00:00Z",category:"new-games",tags:[],score:80,selected:true,channel:"news",x:null,story:null,readingMode:mode==="restricted"?"summary-only":"full",author:null,outline:[],relatedStories:[],topics:[],indexable:false,markdownAvailable:mode==="body",group:null,hasTranslation:false,bodyLanguage:"zh",body:mode==="body"?{zh:"<h2>测试新闻的原始正文</h2><p>这是从固定测试材料提供的正文，不是 AI 导读。</p>",original:null,zhKind:"original",complete:true}:null};
    if(mode==="policy")item.bodyUnavailableReason="source-policy";
    if(mode==="pending")item.bodyUnavailableReason="pending";
    return res.end(JSON.stringify(item));
  }
  res.statusCode=404;res.end("{}");
});
let web:WebServer,browser:Browser;
before(async()=>{web=await startWebServer(api);browser=await chromium.launch(process.env.ASK_TEST_CHROME_PATH?{executablePath:process.env.ASK_TEST_CHROME_PATH}:{channel:"chromium"});});
after(async()=>{await browser?.close();await web?.stop();});
for(const mode of ["body","missing","restricted","policy","pending"] as const)test(`article ${mode}: show original body, a clear fallback, or the explicit summary restriction`,async()=>{
  const page=await browser.newPage({reducedMotion:"reduce"});try{
    await page.route("https://fonts.googleapis.com/**",r=>r.abort());
    await page.goto(web.origin+"/items/"+mode+"-fixture");
    await expect(page.getByRole("heading",{name:"新闻正文展示检查",exact:true})).toBeVisible();
    await expect(page.getByText("这是固定的 AI 导读，与新闻原文分开展示。",{exact:true})).toBeVisible();
    if(mode==="body"){
      await expect(page.getByRole("heading",{name:"测试新闻的原始正文",exact:true})).toBeVisible();
      await expect(page.getByText("这是从固定测试材料提供的正文，不是 AI 导读。",{exact:true})).toBeVisible();
      await expect(page.getByText("暂未获取到可展示的正文，上方是 AI 导读。",{exact:true})).toHaveCount(0);
    }else if(mode==="missing"){
      await expect(page.getByText("暂未获取到可展示的正文，上方是 AI 导读。",{exact:true})).toBeVisible();
      await expect(page.getByRole("link",{name:/前往来源网站阅读完整原文/})).toHaveAttribute("href","https://example.org/original-article");
    }else if(mode==="policy"||mode==="pending"){
      await expect(page.getByText(mode==="policy"?"当前来源设置为仅展示摘要，上方是 AI 导读。":"正文尚未就绪，上方是 AI 导读。",{exact:true})).toBeVisible();
      await expect(page.getByText("暂未获取到可展示的正文，上方是 AI 导读。",{exact:true})).toHaveCount(0);
      await expect(page.getByRole("link",{name:/前往来源网站阅读完整原文/})).toHaveAttribute("href","https://example.org/original-article");
    }else{
      await expect(page.getByText(/应来源方要求，这里只提供摘要与原文入口/)).toBeVisible();
      await expect(page.getByRole("heading",{name:"新闻正文",exact:true})).toHaveCount(0);
    }
  }finally{await page.close();}
});
test("phone article keeps the original body readable below the AI introduction",async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:"reduce"});try{
    await page.route("https://fonts.googleapis.com/**",r=>r.abort());await page.goto(web.origin+"/items/body-fixture");
    await expect(page.getByRole("heading",{name:"测试新闻的原始正文",exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }finally{await page.close();}
});
