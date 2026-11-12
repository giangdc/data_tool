import { listPackages } from '../src/app/order.js';
const g = await listPackages();
for (const [grp, list] of Object.entries(g)) {
  console.log(`\n=== ${grp} (${list.length} gói) ===`);
  for (const p of list) console.log(`  • ${p.name} (id ${p.subServiceId}) — ${p.prepaids.length} chu kỳ: ${p.prepaids.map((x)=>x.label).slice(0,4).join(' | ')}${p.prepaids.length>4?' …':''}`);
}
