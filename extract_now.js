const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const BASE    = 'https://cricclubs.com/NJSBCL';
const CLUB_ID = '2690';
const WW_ID   = '3613';
const DATA    = path.join(__dirname, 'data');

const fi = v => { const n = parseFloat(String(v).replace(/[^0-9.-]/g,'')); return isNaN(n) ? 0 : Math.round(n*100)/100; };
const ii = v => { const n = parseInt(String(v).replace(/[^0-9]/g,''));    return isNaN(n) ? 0 : n; };
function ci(h, ...keys) {
  for (const k of keys) { const i = h.findIndex(x => x===k || x.startsWith(k)); if (i>=0) return i; }
  return -1;
}

async function getPage(browser) {
  return browser.contexts()[0].pages()[0];
}

async function goAndExtract(page, url) {
  console.log('  ->', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // CricClubs renders tables via JS — needs ~8-10s after domcontentloaded
  await page.waitForTimeout(10000);

  return page.evaluate(() =>
    [...document.querySelectorAll('table')].map(table => {
      // Use direct children only (th or td) to avoid picking up nested tables
      const headRow = table.querySelector('thead tr');
      const headers = headRow
        ? [...headRow.children].filter(el => ['TH','TD'].includes(el.tagName))
            .map(h => h.innerText.trim().toLowerCase().replace(/'/g,'').replace(/\s+/g,' '))
        : [];
      const rows = [...table.querySelectorAll('tbody tr')]
        .map(tr => [...tr.children]
          .filter(el => ['TH','TD'].includes(el.tagName))
          .map(el => el.innerText.trim().replace(/\s+/g,' ')))
        .filter(r => r.length > 2 && r.some(c => c.length > 0));
      return { headers, rows };
    }).filter(t => t.headers.length >= 4 && t.rows.length > 0)
  );
}

function parseBatting(tables, season) {
  for (const t of tables) {
    const h = t.headers;
    if (ci(h,'runs','run') < 0 || ci(h,'ins','i','inns') < 0) continue;
    const c = {
      name:   ci(h,'player','name'),
      mat:    ci(h,'mat','m'),
      ins:    ci(h,'ins','i','inns'),
      no:     ci(h,'no'),
      runs:   ci(h,'runs','run'),
      balls:  ci(h,'balls','b','ball'),
      avg:    ci(h,'avg','average'),
      sr:     ci(h,'sr','s/r','strikerate'),
      hs:     ci(h,'hs'),
      fifties: ci(h,"50s","50","fifties"),
      tFives:  ci(h,"25s","25","twentyfives"),
    };
    if (c.runs < 0 || c.name < 0) continue;
    const recs = t.rows
      .filter(r => r[0] && !isNaN(parseInt(r[0])))
      .map((r, idx) => ({
        season, rank: idx + 1,
        name:        r[c.name]?.trim() || '',
        mat:         c.mat>=0  ? ii(r[c.mat])  : 0,
        ins:         c.ins>=0  ? ii(r[c.ins])  : 0,
        no:          c.no>=0   ? ii(r[c.no])   : 0,
        runs:        ii(r[c.runs]),
        balls:       c.balls>=0 ? ii(r[c.balls]) : 0,
        avg:         c.avg>=0  ? fi(r[c.avg])  : 0,
        sr:          c.sr>=0   ? fi(r[c.sr])   : 0,
        hs:          c.hs>=0   ? ii(r[c.hs])   : 0,
        fifties:     c.fifties>=0 ? ii(r[c.fifties]) : 0,
        twentyfives: c.tFives>=0  ? ii(r[c.tFives])  : 0,
      }))
      .filter(r => r.name && r.name.toLowerCase() !== 'player');
    if (recs.length >= 3) return recs;
  }
  return [];
}

function parseBowling(tables, season) {
  for (const t of tables) {
    const h = t.headers;
    if (ci(h,'wkts','wkt','wickets') < 0 || ci(h,'overs','o') < 0) continue;
    const c = {
      name:  ci(h,'player','name'),
      mat:   ci(h,'mat','m'),
      inns:  ci(h,'inns','i','ins'),
      overs: ci(h,'overs','o'),
      runs:  ci(h,'runs','run'),
      wkts:  ci(h,'wkts','wkt','wickets','w'),
      bbf:   ci(h,'bbf','bb','best'),
      dots:  ci(h,'dots','dot'),
      econ:  ci(h,'econ','economy'),
      ave:   ci(h,'ave','avg','average'),
      sr:    ci(h,'sr','s/r'),
    };
    if (c.wkts < 0 || c.name < 0) continue;
    const recs = t.rows
      .filter(r => r[0] && !isNaN(parseInt(r[0])))
      .map((r, idx) => ({
        season, rank: idx + 1,
        name:  r[c.name]?.trim() || '',
        mat:   c.mat>=0   ? ii(r[c.mat])   : 0,
        inns:  c.inns>=0  ? ii(r[c.inns])  : 0,
        overs: c.overs>=0 ? fi(r[c.overs]) : 0,
        runs:  c.runs>=0  ? ii(r[c.runs])  : 0,
        wkts:  ii(r[c.wkts]),
        bbf:   c.bbf>=0   ? (r[c.bbf]||'-') : '-',
        dots:  c.dots>=0  ? ii(r[c.dots])  : 0,
        econ:  c.econ>=0  ? fi(r[c.econ])  : 0,
        ave:   c.ave>=0   ? fi(r[c.ave])   : 0,
        sr:    c.sr>=0    ? fi(r[c.sr])    : 0,
      }))
      .filter(r => r.name && r.name.toLowerCase() !== 'player');
    if (recs.length >= 2) return recs;
  }
  return [];
}

function save(filename, data) {
  fs.writeFileSync(path.join(DATA, filename), JSON.stringify(data, null, 2));
  console.log(`  Saved data/${filename} — ${data.length} records`);
}

(async () => {
  console.log('Connecting to Edge...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = await getPage(browser);
  console.log('Connected. Page:', page.url());

  const allBatting = [], allBowling = [];

  // --- 2026 (current, no leagueId param needed) ---
  console.log('\n=== 2026 Weekenders ===');

  const batTables26 = await goAndExtract(page, `${BASE}/teamBatting.do?teamId=${WW_ID}&clubId=${CLUB_ID}`);
  console.log(`  Tables found: ${batTables26.length}, headers sample:`, batTables26[0]?.headers);
  const bat26 = parseBatting(batTables26, '2026');
  console.log(`  Batting players: ${bat26.length}`);
  bat26.forEach(p => console.log(`    ${p.rank}. ${p.name} — ${p.runs} runs @ avg ${p.avg}, SR ${p.sr}`));
  allBatting.push(...bat26);

  const bowlTables26 = await goAndExtract(page, `${BASE}/teamBowling.do?teamId=${WW_ID}&clubId=${CLUB_ID}`);
  const bowl26 = parseBowling(bowlTables26, '2026');
  console.log(`  Bowling players: ${bowl26.length}`);
  bowl26.forEach(p => console.log(`    ${p.rank}. ${p.name} — ${p.wkts} wkts @ econ ${p.econ}`));
  allBowling.push(...bowl26);

  // Save
  if (allBatting.length) save('warriors_batting.json', allBatting);
  else console.log('WARNING: No batting data saved.');

  if (allBowling.length) save('warriors_bowling.json', allBowling);
  else console.log('WARNING: No bowling data saved.');

  await browser.close();
  console.log('\nDone! Run: git add data/ && git commit -m "Update real stats" && git push');
})();
