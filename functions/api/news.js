// Cloudflare Pages Function — serves /api/news
// Identical logic to api/news.js (Vercel); adapted for the Workers runtime.

const RSS_FEEDS = {
  en: [
    { key: 'hindu',    label: 'The Hindu',      badgeClass: 'badge-hindu', url: 'https://www.thehindu.com/news/feeder/default.rss' },
    { key: 'ie',       label: 'Indian Express', badgeClass: 'badge-ie',    url: 'https://indianexpress.com/feed/' },
  ],
  hi: [
    { key: 'hindu-hi',   label: 'द हिंदू',     badgeClass: 'badge-hindu', url: 'https://www.thehindu.com/hindi/feeder/default.rss' },
    { key: 'amarujala',  label: 'अमर उजाला',   badgeClass: 'badge-au',    url: 'https://www.amarujala.com/rss/breaking-news.xml' },
  ],
};

// Per-isolate rate limiting — resets on cold start, good enough to block scripted abuse
const rateMap = new Map();
const RATE_LIMIT  = 60;
const RATE_WINDOW = 60_000;

function checkRate(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) { rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW }); return true; }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Samachar-RSS-Reader/1.0)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(10_000),
    redirect: 'follow',
    cf: { cacheTtl: 300, cacheEverything: true }, // CF edge-caches upstream RSS for 5 min
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 5_242_880) throw new Error('Feed response too large');
  return text;
}

function cleanText(raw) {
  if (!raw) return '';
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”').replace(/&ldquo;/g, '“').replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/\s+/g, ' ').trim();
}

function scoreSentence(s) {
  let score = 0;
  const sl = s.toLowerCase();
  if (/\d/.test(s)) score += 2;
  score += Math.min((s.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || []).length, 4);
  for (const kw of ['india','government','minister','parliament','supreme court','rbi',
    'policy','scheme','act','bill','election','budget','gdp','isro',
    'treaty','agreement','union','state','court','commission','report'])
    if (sl.includes(kw)) score++;
  const wc = s.split(/\s+/).length;
  if (wc < 6) score -= 3;
  if (wc > 40) score -= 1;
  return score;
}

function smartExcerpt(description, title = '', maxWords = 65) {
  const text = cleanText(description);
  if (!text) return cleanText(title);

  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 20);
  if (!sentences.length) {
    const words = text.split(/\s+/);
    return words.slice(0, maxWords).join(' ') + (words.length > maxWords ? '…' : '');
  }

  const scored = sentences
    .map((s, i) => ({ s, i, score: scoreSentence(s) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const chosen = []; let wordCount = 0;
  for (const { s } of scored) {
    const w = s.split(/\s+/).length;
    if (wordCount + w <= maxWords) { chosen.push(s); wordCount += w; }
    if (wordCount >= maxWords - 5) break;
  }
  if (!chosen.length) chosen.push(sentences[0]);

  const chosenSet = new Set(chosen);
  const result = sentences.filter(s => chosenSet.has(s)).join(' ');
  const words = result.split(/\s+/);
  return words.length > maxWords + 5 ? words.slice(0, maxWords).join(' ') + '…' : result;
}

function getTag(xml, tagName) {
  const re = new RegExp(`<${tagName}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tagName}>`, 'i');
  const m = xml.match(re);
  return m ? (m[1] !== undefined ? m[1] : (m[2] || '')) : '';
}

function parseRSS(xmlText, feedMeta) {
  const items = [];
  const blocks = xmlText.match(/<item[\s>][\s\S]*?<\/item>/g) || [];
  for (const block of blocks.slice(0, 30)) {
    const title   = cleanText(getTag(block, 'title'));
    const link    = getTag(block, 'link') || getTag(block, 'guid');
    const rawDesc = getTag(block, 'content:encoded') || getTag(block, 'description');
    const pub     = getTag(block, 'pubDate');
    if (!title || !link) continue;
    let summary = smartExcerpt(rawDesc, title);
    if (summary.trim().toLowerCase() === title.trim().toLowerCase()) summary = '';
    items.push({ id: link, title, link, description: summary, pubDate: pub,
      source: feedMeta.key, sourceLabel: feedMeta.label, badgeClass: feedMeta.badgeClass });
  }
  return items;
}

const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestGet(context) {
  const ip = context.request.headers.get('cf-connecting-ip') ||
             context.request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
             'unknown';

  if (!checkRate(ip)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: BASE_HEADERS,
    });
  }

  const lang = new URL(context.request.url).searchParams.get('lang') === 'hi' ? 'hi' : 'en';
  const feeds = RSS_FEEDS[lang];

  const allItems = [];
  for (const feed of feeds) {
    try {
      const xml = await fetchFeed(feed.url);
      allItems.push(...parseRSS(xml, feed));
    } catch (e) {
      console.error(`Feed error (${feed.label}): ${e.message}`);
    }
  }

  allItems.sort((a, b) => {
    try { return new Date(b.pubDate) - new Date(a.pubDate); } catch { return 0; }
  });

  return new Response(JSON.stringify({ status: 'ok', items: allItems }), {
    headers: {
      ...BASE_HEADERS,
      // s-maxage: Cloudflare edge caches this response for 5 min — function only
      // runs on cache miss, so 1000 users in the same region = ~1 invocation/5 min
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
    },
  });
}
