import assert from "node:assert/strict";
import {after,before,test} from "node:test";
import {mkdir} from "node:fs/promises";
import {chromium,expect,type Browser} from "@playwright/test";
import {startWebServer,type WebServer} from "./web-server.ts";
import {createServer} from "node:http";
import {addDays} from "@aihot/contracts/time";
import type {AdminAnalytics} from "@aihot/contracts/analytics";

let browser:Browser,web:WebServer;
let populated=false;
// Browser rendering fixtures only. Metrics/collection are tested against PostgreSQL in tests/analytics.test.ts.
function view(days:7|30|90):AdminAnalytics {
 const today="2026-11-02",start=addDays(today,1-days);
 return {days,today,start,generatedAt:today+"T10:00:00Z",startedAt:(populated?"2026-11-01":"2026-11-02")+"T10:00:00Z",
 summary:populated?{dau:2,yesterday:1,wau:2,mau:2,pv:2,newVisitors:1}:{dau:0,yesterday:0,wau:0,mau:0,pv:0,newVisitors:0},
 trend:Array.from({length:days},(_,i)=>{const date=addDays(start,i),known=date>=(populated?"2026-11-01":"2026-11-02");return{date,active:known?(populated?(date===today?2:1):0):null,newVisitors:known?(populated?1:0):null};}),
 modules:populated?[{module:"ask",visitors:1,pv:1},{module:"featured",visitors:1,pv:1},{module:"radar",visitors:1,pv:1}]:[],
 audience:populated?{total:2,newVisitors:2,returning:0}:{total:0,newVisitors:0,returning:0},
 sources:populated?[{label:"store.steampowered.com",visitors:1},{label:"www.google.com",visitors:1}]:[],devices:populated?[{label:"PC",visitors:2}]:[]};
}
const api=createServer(async(req,res)=>{
 const url=new URL(req.url!,"http://local");res.setHeader("content-type","application/json");
 if(url.pathname==="/api/site/meta")return res.end(JSON.stringify({changelogVersion:null}));
 if(url.pathname==="/api/admin/me")return res.end(JSON.stringify({name:"浏览器测试管理员",csrf:"dev",dev:true}));
 if(url.pathname==="/api/admin/nav-counts")return res.end("{}");
 if(url.pathname==="/api/admin/analytics")return res.end(JSON.stringify(view(Number(url.searchParams.get("days")??30) as 7|30|90)));
 if(url.pathname==="/api/site/visit")assert.fail("admin navigation must never send a visit");
 res.statusCode=404;res.end("{}");
});
before(async()=>{web=await startWebServer(api);browser=await chromium.launch(process.env.ASK_TEST_CHROME_PATH?{executablePath:process.env.ASK_TEST_CHROME_PATH}:{channel:"chromium"});});
after(async()=>{await browser?.close();await web?.stop();});

test("admin analytics renders uncollected and empty states in both themes and desktop/phone",async()=>{
 await mkdir(".data/analytics-screenshots",{recursive:true});
 for(const width of [1440,768,390])for(const theme of ["light","dark"]){
  const context=await browser.newContext({viewport:{width,height:950},reducedMotion:"reduce"});
  try{
   await context.addInitScript(t=>localStorage.setItem("aihot-theme",t),theme);
   const page=await context.newPage();await page.route("https://fonts.googleapis.com/**",r=>r.abort());
   await page.goto(web.origin+"/admin/analytics");
   await expect(page.getByRole("heading",{name:"用户活跃分析",exact:true})).toBeVisible();
   await expect(page.getByText("尚无功能访问记录")).toBeVisible();
   await expect(page.getByText("今日活跃 · DAU").locator("..")).toContainText("0");
   await page.getByRole("button",{name:"近 90 天",exact:true}).click();
   await expect(page).toHaveURL(/days=90/);await expect(page.getByRole("button",{name:"近 90 天",exact:true})).toHaveAttribute("aria-pressed","true");
   await page.getByRole("img",{name:/每日活跃/}).focus();await page.keyboard.press("Home");
   await expect(page.getByText(/尚未采集/)).toBeVisible();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:`.data/analytics-screenshots/empty-${width}-${theme}.png`,fullPage:true});
  }finally{await context.close();}
 }

});

test("collected data renders metrics, ranges, chart, ranking and proportions",async()=>{
 populated=true;
 for(const width of [1440,390])for(const theme of ["light","dark"]){
  const context=await browser.newContext({viewport:{width,height:950},reducedMotion:"reduce"});
  try{
   await context.addInitScript(t=>localStorage.setItem("aihot-theme",t),theme);
   const page=await context.newPage();await page.route("https://fonts.googleapis.com/**",r=>r.abort());
   await page.goto(web.origin+"/admin/analytics?days=7");
   await expect(page.getByText("今日活跃 · DAU").locator("..")).toContainText("2");
   await expect(page.getByText("今日新增访客",{exact:true}).locator("..")).toContainText("1");
   await expect(page.locator("main li").filter({hasText:"游戏异动"})).toBeVisible();
   await expect(page.getByText("store.steampowered.com",{exact:true})).toBeVisible();
   const chart=page.getByRole("img",{name:/每日活跃/});await chart.focus();await page.keyboard.press("End");
   await expect(page.getByText(/活跃 2 人 · 新增 1 人/)).toBeVisible();
   await page.getByRole("button",{name:"近 30 天",exact:true}).click();await expect(page).toHaveURL(/days=30/);
   await page.getByRole("button",{name:"刷新数据",exact:true}).click();await expect(page.getByRole("button",{name:"刷新数据",exact:true})).toBeEnabled();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:`.data/analytics-screenshots/data-${width}-${theme}.png`,fullPage:true});
  }finally{await context.close();}
 }
});
