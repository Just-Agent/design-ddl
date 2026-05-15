import fs from 'node:fs';

async function uxDesignAwardsAdapter() {
  return {
    source: "UX Design Awards",
    url: "https://ux-design-awards.com",
    items: [],
    note: 'TODO: implement parser for UX Design Awards; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function ifDesignAdapter() {
  return {
    source: "iF Design Award",
    url: "https://ifdesign.com",
    items: [],
    note: 'TODO: implement parser for iF Design Award; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function redDotAdapter() {
  return {
    source: "Red Dot Award",
    url: "https://www.red-dot.org",
    items: [],
    note: 'TODO: implement parser for Red Dot Award; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function awwwardsAdapter() {
  return {
    source: "Awwwards",
    url: "https://www.awwwards.com",
    items: [],
    note: 'TODO: implement parser for Awwwards; keep data/items.json as curated fallback until parser is verified.'
  };
}

const adapters = [uxDesignAwardsAdapter, ifDesignAdapter, redDotAdapter, awwwardsAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
const reports = [];

for (const adapter of adapters) {
  reports.push(await adapter());
}

const harvestedItems = reports.flatMap(report => report.items);
if (harvestedItems.length > 0) {
  fs.writeFileSync(existingItemsUrl, JSON.stringify(harvestedItems, null, 2) + '\n', 'utf8');
  console.log(`crawler wrote ${harvestedItems.length} fetched items`);
} else {
  console.log(`crawler adapters ran; no verified fetched items yet, preserving ${existingItems.length} curated items`);
}

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  generatedAt: new Date().toISOString(),
  topicId: "design-ddl",
  adapters: reports
}, null, 2) + '\n', 'utf8');
