import fs from 'fs';
const paths = [
  'C:\\Users\\Dell\\AppData\\Local\\Temp\\opencode\\swarm-tb\\db\\base44-offline-store.json',
  'C:\\Users\\Dell\\AppData\\Local\\Temp\\swe-unz-x\\db\\base44-offline-store.json',
];
for (const p of paths) {
  if (!fs.existsSync(p)) continue;
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  const entities = s.entities || s;
  console.log('== ' + p + ' ==');
  console.log('top keys:', Object.keys(s).join(', '));
  const rev = entities.RevenueEvent || entities.revenue_events || entities.revenues;
  if (Array.isArray(rev)) {
    const c = {};
    for (const r of rev) { const st = (r.status || '?'); c[st] = (c[st]||0)+1; }
    console.log('RevenueEvent count:', rev.length, 'by status:', JSON.stringify(c));
    console.log('sample keys:', Object.keys(rev[0]||{}).join(', '));
  } else {
    console.log('RevenueEvent not an array; typeof', typeof rev);
  }
  break;
}
