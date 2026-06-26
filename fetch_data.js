/**
 * Waterfront Warriors — CricClubs Scraper
 * Uses your real Edge browser so Cloudflare doesn't block it.
 *
 * HOW TO USE:
 *   node fetch_data.js
 *
 * It will open Edge with remote debugging enabled.
 * Log in to CricClubs normally, then press ENTER here.
 */

const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const readline = require('readline');

const BASE    = 'https://cricclubs.com/NJSBCL';
const CLUB_ID = '2690';
const WW_ID   = '3613';
const DATA    = path.join(__dirname, 'data');
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DEBUG_PORT = 9222;
const USER_DATA  = path.join(require('os').tmpdir(), 'ww-edge-session');

function waitForEnter(msg) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(msg, () => { rl.close(); resolve(); });
  });
}

async function goTo(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
}

async function extractTables(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('table')].map(table => {
      const headRow = table.querySelector('thead tr');
      const headers = headRow
        ? [...headRow.children].filter(el => ['TH','TD'].includes(el.tagName))
            .map(h => h.innerText.trim().toLowerCase())
        : [];
      const rows = [...table.querySelectorAll('tbody tr')]
        .map(tr => [...tr.children]
          .filter(el => ['TH','TD'].includes(el.tagName))
          .map(el => el.innerText.trim().replace(/\s+/g,' ')))
        .filter(r => r.length > 2 && r.some(c => c.length > 0));
      return { headers, rows };
    }).filter(t => t.headers.length > 0 && t.rows.length > 0);
  });
}

const fi = v => { const n = parseFloat(String(v).replace(/[^0-9.-]/g,'')); return isNaN(n) ? 0 : Math.round(n*100)/100; };
const ii = v => { const n = parseInt(String(v).replace(/[^0-9]/g,''));    return isNaN(n) ? 0 : n; };
function ci(h, ...keys) {
  for (const k of keys) { const i = h.findIndex(x => x === k || x.startsWith(k)); if (i >= 0) return i; }
  return -1;
}

function parseBatting(tables, season) {
  for (const t of tables) {
    const h = t.headers;
    if (ci(h, 'runs', 'run') < 0) continue;
    const c = {
      name: ci(h,'player','name'), mat: ci(h,'mat','m'),
      ins:  ci(h,'ins','i','inns'), no: ci(h,'no'),
      runs: ci(h,'runs','run'),    balls: ci(h,'balls','b','ball'),
      avg:  ci(h,'avg','average'), sr: ci(h,'sr','s/r'),
      hs:   ci(h,'hs'),            fifties: ci(h,'50s','fifties'),
      tFives: ci(h,'25s','twentyfives'),
    };
    const records = t.rows
      .filter(r => r[0] && !isNaN(parseInt(r[0])))
      .map((r, idx) => ({
        season, rank: idx + 1,
        name:        c.name >= 0 ? r[c.name].trim() : r[1]?.trim() || '',
        mat:         c.mat  >= 0 ? ii(r[c.mat])  : 0,
        ins:         c.ins  >= 0 ? ii(r[c.ins])  : 0,
        no:          c.no   >= 0 ? ii(r[c.no])   : 0,
        runs:        c.runs >= 0 ? ii(r[c.runs]) : 0,
        balls:       c.balls>= 0 ? ii(r[c.balls]): 0,
        avg:         c.avg  >= 0 ? fi(r[c.avg])  : 0,
        sr:          c.sr   >= 0 ? fi(r[c.sr])   : 0,
        hs:          c.hs   >= 0 ? ii(r[c.hs])   : 0,
        fifties:     c.fifties >= 0 ? ii(r[c.fifties]) : 0,
        twentyfives: c.tFives  >= 0 ? ii(r[c.tFives])  : 0,
      }))
      .filter(r => r.name && r.name.toLowerCase() !== 'player');
    if (records.length) return records;
  }
  return [];
}

function parseBowling(tables, season) {
  for (const t of tables) {
    const h = t.headers;
    if (ci(h,'wkts','wkt','wickets') < 0) continue;
    const c = {
      name:  ci(h,'player','name'), mat:   ci(h,'mat','m'),
      inns:  ci(h,'inns','i','ins'),overs: ci(h,'overs','o'),
      runs:  ci(h,'runs','run'),    wkts:  ci(h,'wkts','wkt','wickets','w'),
      bbf:   ci(h,'bbf','bb'),      dots:  ci(h,'dots','dot'),
      econ:  ci(h,'econ','economy'),ave:   ci(h,'ave','avg'),
      sr:    ci(h,'sr','s/r'),
    };
    const records = t.rows
      .filter(r => r[0] && !isNaN(parseInt(r[0])))
      .map((r, idx) => ({
        season, rank: idx + 1,
        name:  c.name  >= 0 ? r[c.name].trim()  : r[1]?.trim() || '',
        mat:   c.mat   >= 0 ? ii(r[c.mat])   : 0,
        inns:  c.inns  >= 0 ? ii(r[c.inns])  : 0,
        overs: c.overs >= 0 ? fi(r[c.overs]) : 0,
        runs:  c.runs  >= 0 ? ii(r[c.runs])  : 0,
        wkts:  c.wkts  >= 0 ? ii(r[c.wkts])  : 0,
        bbf:   c.bbf   >= 0 ? (r[c.bbf] || '-') : '-',
        dots:  c.dots  >= 0 ? ii(r[c.dots])  : 0,
        econ:  c.econ  >= 0 ? fi(r[c.econ])  : 0,
        ave:   c.ave   >= 0 ? fi(r[c.ave])   : 0,
        sr:    c.sr    >= 0 ? fi(r[c.sr])    : 0,
      }))
      .filter(r => r.name && r.name.toLowerCase() !== 'player');
    if (records.length) return records;
  }
  return [];
}

function save(filename, data) {
  fs.writeFileSync(path.join(DATA, filename), JSON.stringify(data, null, 2));
  console.log(`Saved data/${filename} — ${data.length} records`);
}

(async () => {
  // Launch real Edge with remote debugging
  console.log('Launching Edge...');
  const edgeProc = spawn(EDGE, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${USER_DATA}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://cricclubs.com/NJSBCL/',
  ], { detached: true, stdio: 'ignore' });
  edgeProc.unref();

  // Give Edge time to start
  await new Promise(r => setTimeout(r, 4000));

  console.log('\nEdge is open with CricClubs.');
  console.log('Log in to your CricClubs account, then come back here.\n');
  await waitForEnter('>>> Press ENTER once you are logged in: ');

  // Connect Playwright to the running Edge instance
  console.log('\nConnecting to Edge...');
  const browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
  const contexts = browser.contexts();
  const page = contexts[0]?.pages()[0] || await contexts[0].newPage();

  console.log('Connected. Extracting data...\n');

  const allBatting = [];
  const allBowling = [];

  // Detect seasons from dropdown
  await goTo(page, `${BASE}/teamBatting.do?teamId=${WW_ID}&clubId=${CLUB_ID}`);
  const seasonOpts = await page.evaluate(() => {
    return [...document.querySelectorAll('select option')]
      .map(o => ({ text: o.innerText.trim(), value: o.value.trim() }))
      .filter(o => o.value && !o.text.toLowerCase().includes('select'));
  });

  const seasons = seasonOpts.length
    ? seasonOpts.map(o => ({ label: o.text.match(/\d{4}/)?.[0] || o.text, param: `&leagueId=${o.value}` }))
    : [{ label: '2026', param: '' }, { label: '2025', param: '&leagueId=53' }];

  console.log('Seasons:', seasons.map(s => s.label).join(', '));

  for (const s of seasons) {
    console.log(`\n--- ${s.label} ---`);

    process.stdout.write('  Batting... ');
    await goTo(page, `${BASE}/teamBatting.do?teamId=${WW_ID}&clubId=${CLUB_ID}${s.param}`);
    const bat = parseBatting(await extractTables(page), s.label);
    console.log(`${bat.length} players`);
    bat.forEach(p => console.log(`    ${p.rank}. ${p.name} — ${p.runs} runs`));
    allBatting.push(...bat);

    process.stdout.write('  Bowling... ');
    await goTo(page, `${BASE}/teamBowling.do?teamId=${WW_ID}&clubId=${CLUB_ID}${s.param}`);
    const bowl = parseBowling(await extractTables(page), s.label);
    console.log(`${bowl.length} players`);
    bowl.forEach(p => console.log(`    ${p.rank}. ${p.name} — ${p.wkts} wkts`));
    allBowling.push(...bowl);
  }

  if (allBatting.length)  save('warriors_batting.json', allBatting);
  else console.log('WARNING: No batting data found. Are you logged in?');

  if (allBowling.length)  save('warriors_bowling.json', allBowling);
  else console.log('WARNING: No bowling data found.');

  await browser.close();
  console.log('\nDone! Run:  git add data/ && git commit -m "Update stats" && git push');
})();
