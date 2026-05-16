import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const CRAWL_TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS) || 20000;
const REACHABILITY_TIMEOUT_MS = Number(process.env.REACHABILITY_TIMEOUT_MS) || Math.min(7000, CRAWL_TIMEOUT_MS);
const USER_AGENT = 'Just-DDL-Crawler/1.0 (+https://just-agent.github.io/just-ddl/)';

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim().slice(0, 200) : null;
}

function fetchViaPowerShell(url) {
  if (process.platform !== 'win32') return null;
  const timeoutSec = Math.max(15, Math.ceil(CRAWL_TIMEOUT_MS / 1000) + 5);
  const escapedUrl = url.replace(/'/g, "''");
  const script = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); (Invoke-WebRequest -Uri '" + escapedUrl + "' -UseBasicParsing -TimeoutSec " + timeoutSec + " -Headers @{ 'User-Agent'='Mozilla/5.0'; 'Accept-Language'='en-US,en;q=0.9' }).Content";
  for (const command of ['pwsh', 'powershell']) {
    const result = spawnSync(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: (timeoutSec + 5) * 1000
    });
    if (result.status === 0 && result.stdout && result.stdout.trim().length > 1000) {
      return result.stdout;
    }
  }
  return null;
}

async function fetchSourcePage(source) {
  const report = {
    sourceId: source.id,
    source: source.name,
    url: source.url,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'Source reachability check only; curated data/items.json preserved until item parser is implemented.',
    error: null
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
    const res = await fetch(source.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    clearTimeout(timer);
    report.httpStatus = res.status;
    report.finalUrl = res.url;
    const text = await res.text();
    report.contentLength = text.length;
    report.title = extractTitle(text);
    report.reachable = res.status >= 200 && res.status < 400;
    report.note = report.reachable
      ? 'Source reachable. Curated data/items.json preserved until item parser is implemented.'
      : `Source returned HTTP ${res.status}. Curated data/items.json preserved.`;
  } catch (err) {
    report.error = err.name === 'AbortError' ? `Timeout after ${REACHABILITY_TIMEOUT_MS}ms` : err.message;
    report.note = `Source fetch failed: ${report.error}. Curated data/items.json preserved.`;
  }
  return report;
}

const UXDA_DATES_URL = 'https://ux-design-awards.com/enter/dates';
const UXDA_MIN_ITEMS = 3;
const UXDA_MAX_FUTURE_DAYS = Number(process.env.UXDA_MAX_FUTURE_DAYS) || 700;

function uxdaDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function uxdaText(html) {
  return uxdaDecode(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uxdaSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseUxdaDate(dayMonth, year) {
  const months = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11,jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const match = String(dayMonth || '').match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/i);
  if (!match) return null;
  const month = months[match[2].toLowerCase()];
  const day = Number(match[1]);
  if (month === undefined || !day || !year) return null;
  return new Date(Date.UTC(Number(year), month, day, 23, 59, 59));
}

async function parseUxDesignAwardsItems() {
  const report = {
    sourceId: 'uxda',
    source: 'UX Design Awards',
    url: UXDA_DATES_URL,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'UX Design Awards dates parser.',
    error: null,
    parsedItemCount: 0,
    invalidItemCount: 0,
    parserHealthy: false
  };
  try {
    let text;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);
      const res = await fetch(UXDA_DATES_URL, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
      });
      clearTimeout(timer);
      report.httpStatus = res.status;
      report.finalUrl = res.url;
      text = await res.text();
      report.reachable = res.status >= 200 && res.status < 400;
    } catch (fetchErr) {
      const fallbackText = fetchViaPowerShell(UXDA_DATES_URL);
      if (!fallbackText) throw fetchErr;
      text = fallbackText;
      report.httpStatus = 200;
      report.finalUrl = UXDA_DATES_URL;
      report.reachable = true;
      report.note = 'Fetched UX Design Awards with Windows PowerShell fallback after Node fetch failed.';
    }
    report.contentLength = text.length;
    report.title = (text.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || null;
    if (!report.reachable) {
      report.note = 'UX Design Awards returned HTTP ' + report.httpStatus + '. No items parsed.';
      return report;
    }

    const clean = uxdaText(text);
    const seen = new Set();
    const seasonYear = (clean.match(/UX Design Awards\s+[–-]\s+(Spring|Autumn)\s+(\d{4})/i) || []);
    const currentSeason = seasonYear[1] || 'Autumn';
    const currentYear = seasonYear[2] || '2026';
    const candidates = [
      {
        title: 'Submission period deadline',
        match: clean.match(/Submission Period\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+[–-]\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+)\s+(\d{4})/i),
        stage: 'Deadline',
        season: currentSeason,
        awardYear: currentYear
      },
      {
        title: 'Nomination review closes',
        match: clean.match(/First Award Level:\s+Nomination\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+[–-]\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+)\s+(\d{4})/i),
        stage: 'Milestone',
        season: currentSeason,
        awardYear: currentYear
      },
      {
        title: 'Notification of nominees',
        match: clean.match(/Notification of Nominees\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+)\s+(\d{4})/i),
        stage: 'Milestone',
        season: currentSeason,
        awardYear: currentYear
      },
      {
        title: 'Public nominee announcement',
        match: clean.match(/Public Nominee Announcement\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+)\s+(\d{4})/i),
        stage: 'Milestone',
        season: currentSeason,
        awardYear: currentYear
      },
      {
        title: 'Public Choice Award voting closes',
        match: clean.match(/Public Choice Award Voting\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+[–-]\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+)\s+(\d{4})/i),
        stage: 'Deadline',
        season: currentSeason,
        awardYear: currentYear
      },
      {
        title: 'Winner announcement',
        match: clean.match(/Winner Announcement\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+)\s+(\d{4})/i),
        stage: 'Milestone',
        season: currentSeason,
        awardYear: currentYear
      },
      {
        title: 'Call for participation closes',
        match: clean.match(/Upcoming\s+UX Design Awards\s+[–-]\s+(Spring|Autumn)\s+(\d{4})\s+Call for Participation:\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+[–-]\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+)\s+(\d{4})/i),
        stage: 'Deadline',
        upcoming: true
      }
    ];

    for (const candidate of candidates) {
      if (!candidate.match) {
        report.invalidItemCount += 1;
        continue;
      }
      const season = candidate.upcoming ? candidate.match[1] : candidate.season;
      const awardYear = candidate.upcoming ? candidate.match[2] : candidate.awardYear;
      const dateLabel = candidate.upcoming ? candidate.match[3] : candidate.match[1];
      const dateYear = candidate.upcoming ? candidate.match[4] : candidate.match[2];
      const deadlineDate = parseUxdaDate(dateLabel, dateYear);
      if (!deadlineDate || isNaN(deadlineDate.getTime())) {
        report.invalidItemCount += 1;
        continue;
      }
      const daysFromNow = (deadlineDate.getTime() - Date.now()) / 86400000;
      if (daysFromNow < -7 || daysFromNow > UXDA_MAX_FUTURE_DAYS) {
        report.invalidItemCount += 1;
        continue;
      }
      const fullTitle = 'UX Design Awards ' + season + ' ' + awardYear + ' - ' + candidate.title;
      const id = 'uxda-' + uxdaSlug(season + '-' + awardYear + '-' + candidate.title);
      if (seen.has(id)) continue;
      seen.add(id);
      report.items.push({
        id,
        title: fullTitle,
        deadline: deadlineDate.toISOString().replace('.000Z', 'Z'),
        dateRange: dateLabel + ' ' + dateYear,
        location: 'Online',
        isOnline: true,
        tags: ['UX', 'design', 'award', season],
        url: UXDA_DATES_URL,
        status: 'upcoming',
        description: 'Parsed from official UX Design Awards Dates page.',
        stage: candidate.stage,
        source: 'UX Design Awards',
        type: 'contest'
      });
    }
    report.items.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    report.parsedItemCount = report.items.length;
    report.parserHealthy = report.parsedItemCount >= UXDA_MIN_ITEMS;
    report.note = 'Parsed ' + report.parsedItemCount + ' items from UX Design Awards; rejected ' + report.invalidItemCount + ' entries.';
  } catch (err) {
    report.error = err.name === 'AbortError' ? 'Timeout after ' + CRAWL_TIMEOUT_MS + 'ms' : err.message;
    report.note = 'UX Design Awards fetch failed: ' + report.error;
  }
  return report;
}

async function uxDesignAwardsAdapter() {
  return parseUxDesignAwardsItems();
}
async function ifDesignAdapter() {
  return fetchSourcePage({ id: "if-design", name: "iF Design Award", url: "https://ifdesign.com" });
}

async function redDotAdapter() {
  return fetchSourcePage({ id: "reddot", name: "Red Dot Award", url: "https://www.red-dot.org" });
}

async function awwwardsAdapter() {
  return fetchSourcePage({ id: "awwwards", name: "Awwwards", url: "https://www.awwwards.com" });
}

const adapters = [uxDesignAwardsAdapter, ifDesignAdapter, redDotAdapter, awwwardsAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
let previousParsedItemCount = null;
try {
  const previousReport = JSON.parse(fs.readFileSync(new URL('../data/crawl-report.json', import.meta.url), 'utf8'));
  previousParsedItemCount = previousReport.parsedItemCount ?? null;
} catch {}
const reports = await Promise.all(adapters.map(adapter => adapter()));

const harvestedItems = reports.flatMap(report => report.items);
const parsedItemCount = reports.reduce((s, r) => s + (r.parsedItemCount || 0), 0);
const parserHealthy = reports.every(r => r.parserHealthy !== false);
const parserDropOk = previousParsedItemCount === null || parsedItemCount >= Math.floor(previousParsedItemCount * 0.5);
if (harvestedItems.length >= UXDA_MIN_ITEMS && parserHealthy && parserDropOk) {
  fs.writeFileSync(existingItemsUrl, JSON.stringify(harvestedItems, null, 2) + '\n', 'utf8');
  console.log('crawler wrote ' + harvestedItems.length + ' fetched items');
} else {
  console.log('parser emitted ' + harvestedItems.length + ' items (health gate failed or threshold not met); preserving ' + existingItems.length + ' curated items in data/items.json');
}

const reachableCount = reports.filter(r => r.reachable).length;
console.log('reachability: ' + reachableCount + '/' + reports.length + ' sources reachable');
if (parsedItemCount > 0) console.log('parsedItemCount: ' + parsedItemCount);

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  topicId: "design-ddl",
  generatedAt: new Date().toISOString(),
  adapterCount: reports.length,
  reachableCount,
  parsedItemCount,
  previousParsedItemCount,
  parserHealthy,
  parserDropOk,
  adapters: reports
}, null, 2) + '\n', 'utf8');
