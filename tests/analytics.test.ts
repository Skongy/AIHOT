import "./setup.ts";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import Fastify from "fastify";
import { sql,closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { recordActivity,visitorKey,humanBrowser,deviceOf,trafficSource,pruneAnalytics } from "@aihot/backend/operations/analytics";
import { analyticsOverview } from "@aihot/backend/admin/analytics";
import { analyticsModule } from "@aihot/contracts/analytics";
import { registerVisits } from "../apps/api/src/routes/visits.ts";
import { buildApp } from "../apps/api/src/app.ts";
const PC="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const MOBILE="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const now=new Date("2026-11-02T10:00:00Z");
after(closeDb);
beforeEach(async()=>{await sql`TRUNCATE analytics_modules,analytics_days,analytics_visitors`;});
const id=(n:number)=>n.toString(16).padStart(32,"0");
async function visit(n:number,offset:number,path="/",referrer:unknown="",userAgent=PC){return recordActivity({visitor:id(n),path,referrer,userAgent,siteUrl:"https://gamehot.test"},new Date(now.getTime()+offset*86400000));}

test("anonymous identifiers, known routes, bots, source privacy and device classes",()=>{
 assert.equal(visitorKey(id(1))?.length,64);assert.notEqual(visitorKey(id(1)),id(1));assert.equal(visitorKey("1.2.3.4"),null);
 assert.equal(visitorKey({}),null);assert.equal(humanBrowser(PC),true);assert.equal(humanBrowser("Googlebot/2.1 (+http://www.google.com/bot.html)"),false);
 assert.equal(humanBrowser(""),false);assert.equal(deviceOf(PC),"PC");assert.equal(deviceOf(MOBILE),"移动端");
 assert.equal(trafficSource("https://user:password@example.com/path?secret=1","https://gamehot.test"),"example.com");
 assert.equal(trafficSource("https://gamehot.test/news","https://gamehot.test"),"直接访问 / 未提供");
 for(const path of ["/admin/analytics","/api/health","/assets/a.js","/unknown","/ask/no/such/page"])assert.equal(analyticsModule(path),null);
 assert.equal(analyticsModule("/story/abc"),"hot");assert.equal(analyticsModule("/topics/steam/page/2"),"topics");
});

test("DAU, range-deduplicated WAU/MAU, daily new visitors and distribution totals agree",async()=>{
 await visit(1,-45,"/items/1","https://google.com/search?q=private");
 await visit(1,-1,"/radar","https://steamcommunity.com/private");
 await visit(1,0);await visit(1,0,"/ask");await visit(1,0,"/ask");
 await visit(2,0,"/all","https://x.com/user/post",MOBILE);await visit(2,0,"/hot","https://evil.test",MOBILE);
 await visit(3,0,"/items/3");await visit(4,-6,"/radar","https://reddit.com/r/games");
 await visit(5,-20,"/agent");await visit(6,-35,"/radar");
 const seven=await analyticsOverview("7",now);
 assert.deepEqual({...seven.summary},{dau:3,yesterday:1,wau:4,mau:5,pv:6,newVisitors:2});
 assert.deepEqual({...seven.audience},{total:4,newVisitors:3,returning:1});
 assert.deepEqual({...seven.trend.at(-1)!},{date:"2026-11-02",active:3,newVisitors:2});
 assert.equal(seven.sources.reduce((n,r)=>n+r.visitors,0),4);assert.equal(seven.devices.reduce((n,r)=>n+r.visitors,0),4);
 assert.equal(seven.sources.find(r=>r.label==="x.com")?.visitors,1);assert.ok(!seven.sources.some(r=>r.label==="evil.test"));
 assert.equal(seven.devices.find(r=>r.label==="移动端")?.visitors,1);
 assert.equal(seven.modules.find(r=>r.module==="ask")?.pv,2);assert.equal(seven.modules.reduce((n,r)=>n+r.pv,0),8);
 assert.equal((await analyticsOverview("30",now)).audience.total,5);assert.equal((await analyticsOverview("90",now)).audience.total,6);
 assert.equal(seven.trend.length,7);assert.equal((await analyticsOverview("90",now)).trend.length,90);
});

test("same browser across paths/tabs deduplicates active users without losing concurrent PV",async()=>{
 await Promise.all(Array.from({length:20},(_,i)=>visit(1,0,i%2?"/ask":"/radar")));
 const view=await analyticsOverview("7",now);
 assert.equal(view.summary.dau,1);assert.equal(view.summary.newVisitors,1);assert.equal(view.summary.pv,20);
 assert.equal(view.modules.find(r=>r.module==="ask")?.pv,10);assert.equal(view.modules.find(r=>r.module==="radar")?.pv,10);
 assert.equal(view.modules.reduce((n,r)=>n+r.visitors,0),2,"module UV must not be summed to obtain DAU");
});

test("Shanghai midnight and out-of-order completion preserve the true first observation day",async()=>{
 const input={visitor:id(1),path:"/",referrer:"",userAgent:PC,siteUrl:"https://gamehot.test"};
 await recordActivity(input,new Date("2026-11-01T16:00:00Z"));
 await recordActivity(input,new Date("2026-11-01T15:59:59Z"));
 const view=await analyticsOverview("7",now);
 assert.equal(view.summary.dau,1);assert.equal(view.summary.yesterday,1);assert.equal(view.summary.newVisitors,0);
 assert.equal(view.summary.wau,1);assert.equal(view.trend.at(-2)!.newVisitors,1);
});

test("unknown IDs, bots, health checks and admin paths cannot inflate analytics",async()=>{
 for(const path of ["/admin","/api/health","/unknown"]){assert.equal(await visit(1,0,path),false);}
 assert.equal(await visit(1,0,"/","","Googlebot/2.1"),false);
 assert.equal(await recordActivity({visitor:null,path:"/",referrer:"",userAgent:PC,siteUrl:"https://gamehot.test"}),false);
 const view=await analyticsOverview("7",now);assert.equal(view.summary.pv,0);assert.equal(view.summary.dau,0);
 for(const value of ["1","365","NaN","30 OR 1=1"])await assert.rejects(analyticsOverview(value,now),{statusCode:400});
});

test("uncollected history stays null and source tails preserve the visitor total",async()=>{
 for(let n=1;n<=12;n++)await visit(n,0,"/",`https://source${n}.test/private?token=secret`);
 const view=await analyticsOverview("90",now);
 assert.equal(view.sources.length,9);assert.equal(view.sources.reduce((n,r)=>n+r.visitors,0),12);
 assert.equal(view.sources.at(-1)!.label,"其他来源");assert.equal(view.trend[0]!.active,null);
 assert.equal(view.trend.at(-1)!.active,12);assert.ok(view.sources.every(r=>!r.label.includes("private")));
});

test("public report integration records an anonymous browser without requiring or reading a cookie",async()=>{
 const app=Fastify();registerVisits(app);
 try{
  const headers={origin:new URL(config.siteUrl).origin,"x-forwarded-for":"203.0.113.9","user-agent":PC};
  for(let i=0;i<2;i++)assert.equal((await app.inject({method:"POST",url:"/api/site/visit",headers,payload:{visitor:id(1),path:"/radar?private=1",referrer:"https://example.com/path?private=1"}})).statusCode,204);
  const view=await analyticsOverview("7");assert.equal(view.summary.dau,1);assert.equal(view.summary.pv,2);
  const [saved]=await sql`SELECT visitor_key FROM analytics_visitors`;assert.notEqual(saved.visitor_key,id(1));
 }finally{await app.close();}
});

test("analytics stays administrator-only, validates ranges and never caches private results",async()=>{
 const dev=config.devAdmin;config.devAdmin=null;const app=await buildApp();
 try{
  const denied=await app.inject("/api/admin/analytics");assert.equal(denied.statusCode,401);assert.equal(denied.headers["cache-control"],"no-store");
  config.devAdmin={displayName:"Analytics fixture"};
  assert.equal((await app.inject("/api/admin/analytics?days=365")).statusCode,400);
  const allowed=await app.inject("/api/admin/analytics?days=7");assert.equal(allowed.statusCode,200);assert.equal(allowed.json().trend.length,7);assert.equal(allowed.headers["cache-control"],"no-store");
 }finally{config.devAdmin=dev;await app.close();}
});

test("retention keeps all ninety natural days and first-seen history for returning visitors",async()=>{
 await visit(1,-89,"/radar");await visit(2,-90,"/ask");await visit(3,-366,"/");await visit(4,-200,"/");await visit(4,0,"/");
 const deleted=await pruneAnalytics(now);assert.equal(deleted.days,3);assert.equal(deleted.modules,3);assert.equal(deleted.visitors,1);
 const [old]=await sql`SELECT first_seen_at FROM analytics_visitors WHERE visitor_key=${visitorKey(id(4))}`;
 assert.equal(new Date(old.first_seen_at).toISOString(),new Date(now.getTime()-200*86400000).toISOString());
 const view=await analyticsOverview("90",now);assert.equal(view.audience.total,2);assert.equal(view.audience.returning,1);
 assert.equal(view.trend[0]!.active,1);assert.equal(view.summary.dau,1);
});
