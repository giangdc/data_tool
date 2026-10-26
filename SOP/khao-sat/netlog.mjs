// Ghi API của portal (method, status, url không query, KEY của body/response – không giá trị, không header) -> output/net.log
import { chromium } from 'playwright-core';
import { appendFileSync } from 'node:fs';
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const keys = (o, d = 0) => (o && typeof o === 'object' && d < 3)
  ? (Array.isArray(o) ? `[${o.length}]${o.length ? keys(o[0], d + 1) : ''}` : `{${Object.keys(o).map((k) => k + (typeof o[k] === 'object' && o[k] ? keys(o[k], d + 1) : '')).join(',')}}`) : '';
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const hook = (p) => p.on('response', async (r) => {
  const q = r.request(); if (!['xhr', 'fetch'].includes(q.resourceType()) || /google|gstatic|facebook/.test(r.url())) return;
  const res = await r.text().catch(() => '');
  appendFileSync('output/net.log', `${new Date().toISOString().slice(11, 19)} ${q.method()} ${r.status()} ${r.url().split('?')[0]} query:${[...new URL(r.url()).searchParams.keys()].join(',')} body:${keys(parse(q.postData()))} res:${keys(parse(res)).slice(0, 300)}\n`);
});
for (const c of b.contexts()) { c.pages().forEach(hook); c.on('page', hook); }
console.log('netlog running');
await new Promise(() => {});
