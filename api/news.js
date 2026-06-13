const https = require('https');
const http  = require('http');

const RSS_FEEDS = {
  en: [
    { key: 'hindu',    label: 'The Hindu',      badgeClass: 'badge-hindu', url: 'https://www.thehindu.com/news/feeder/default.rss' },
    { key: 'ie',       label: 'Indian Express', badgeClass: 'badge-ie',    url: 'https://indianexpress.com/feed/' },
  ],
  hi: [
    { key: 'bbc-hi',   label: 'BBC हिंदी',      badgeClass: 'badge-bbc',     url: 'https://feeds.bbci.co.uk/hindi/rss.xml' },
    { key: 'bhaskar',  label: 'दैनिक भास्कर',   badgeClass: 'badge-bhaskar', url: 'https://www.bhaskar.com/rss-v1--category-1061.xml' },
    { key: 'bhaskar',  label: 'दैनिक भास्कर',   badgeClass: 'badge-bhaskar', url: 'https://www.bhaskar.com/rss-v1--category-1125.xml' },
    { key: 'bhaskar',  label: 'दैनिक भास्कर',   badgeClass: 'badge-bhaskar', url: 'https://www.bhaskar.com/rss-v1--category-1051.xml' },
    { key: 'bhaskar',  label: 'दैनिक भास्कर',   badgeClass: 'badge-bhaskar', url: 'https://www.bhaskar.com/rss-v1--category-5707.xml' },
  ],
};

// Allowlist of valid badge class values — prevents CSS class injection
const VALID_BADGE_CLASSES = new Set(['badge-hindu', 'badge-ie', 'badge-au', 'badge-bbc', 'badge-bhaskar']);

// Per-IP rate limiting (in-memory; resets on cold start — enough to block scripted abuse)
const rateMap = new Map();
const RATE_LIMIT   = 60;
const RATE_WINDOW  = 60 * 1000;
function checkRate(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) { rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW }); return true; }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

const MAX_BODY = 5 * 1024 * 1024;

// SSRF protection — block requests to private/loopback/link-local networks
function isSafeHttpsUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0') return false;
  if (/^127\./.test(h)) return false;           // loopback
  if (/^10\./.test(h)) return false;            // RFC1918
  if (/^192\.168\./.test(h)) return false;      // RFC1918
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false; // RFC1918
  if (/^169\.254\./.test(h)) return false;      // link-local / AWS metadata
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return false; // CGNAT RFC6598
  if (/^::1$|^::ffff:/i.test(h)) return false;  // IPv6 loopback/mapped
  return true;
}

function fetchOgDescription(url) {
  return new Promise((resolve) => {
    if (!isSafeHttpsUrl(url)) return resolve('');
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Samachar-RSS-Reader/1.0)', 'Accept': 'text/html' }
    }, (res) => {
      if (res.statusCode >= 300) { res.destroy(); return resolve(''); }
      let buf = '';
      res.on('data', chunk => {
        buf += chunk;
        const m = buf.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{15,}?)["']/i)
               || buf.match(/<meta[^>]+content=["']([^"']{15,}?)["'][^>]+property=["']og:description["']/i);
        if (m) { req.destroy(); return resolve(cleanText(m[1])); }
        if (buf.length > 8192) { req.destroy(); return resolve(''); }
      });
      res.on('end', () => resolve(''));
      res.on('error', () => resolve(''));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(5000, () => { req.destroy(); resolve(''); });
  });
}

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    if (redirects > 0 && !url.startsWith('https://')) return reject(new Error('Redirect to non-HTTPS blocked'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Samachar-RSS-Reader/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, redirects + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      let totalBytes = 0;
      res.on('data', c => {
        totalBytes += c.length;
        if (totalBytes > MAX_BODY) { req.destroy(); return reject(new Error('Feed response too large')); }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function cleanText(raw) {
  if (!raw) return '';
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
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

// Strip any residual HTML tags from a string field
function stripHtml(s) {
  return typeof s === 'string' ? s.replace(/<[^>]+>/g, '').trim() : '';
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
  const re = new RegExp(`<${tagName}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tagName}>`, 'i');
  const m = xml.match(re);
  return m ? (m[1] !== undefined ? m[1] : (m[2] || '')) : '';
}

function parseRSS(xmlText, feedMeta) {
  const items = [];
  const blocks = xmlText.match(/<item[\s>][\s\S]*?<\/item>/g) || [];
  for (const block of blocks.slice(0, 30)) {
    const title = cleanText(getTag(block, 'title'));
    const link  = getTag(block, 'link') || getTag(block, 'guid');
    const rawDesc = getTag(block, 'content:encoded') || getTag(block, 'description');
    const pub   = getTag(block, 'pubDate');

    if (!title || !link) continue;

    // Only accept https article links — rejects javascript: and other schemes
    const trimmedLink = link.trim();
    if (!trimmedLink.startsWith('https://')) continue;

    let summary = smartExcerpt(rawDesc, title);
    if (summary.trim().toLowerCase() === title.trim().toLowerCase()) summary = '';

    items.push({
      id:          trimmedLink.slice(0, 2048),
      title:       title.slice(0, 500),
      link:        trimmedLink.slice(0, 2048),
      description: summary.slice(0, 2000),
      pubDate:     pub,
      source:      feedMeta.key,
      sourceLabel: feedMeta.label,
      badgeClass:  feedMeta.badgeClass,
    });
  }
  return items;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRate(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const lang = req.query?.lang === 'hi' ? 'hi' : 'en';
  const feeds = RSS_FEEDS[lang];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');

  const allItems = [];
  for (const feed of feeds) {
    try {
      const xml = await fetchUrl(feed.url);
      allItems.push(...parseRSS(xml, feed));
    } catch (e) {
      console.error(`Feed error (${feed.label}): ${e.message}`);
    }
  }

  allItems.sort((a, b) => {
    const td = d => { try { return new Date(d).getTime(); } catch { return 0; } };
    return td(b.pubDate) - td(a.pubDate);
  });

  const cutoff = Date.now() - 24 * 3600 * 1000;
  const items = allItems
    .filter(a => { try { return !a.pubDate || new Date(a.pubDate).getTime() >= cutoff; } catch { return true; } })
    .slice(0, 60);

  const noDesc = items.filter(a => !a.description);
  if (noDesc.length) {
    await Promise.all(noDesc.map(async a => {
      // isSafeHttpsUrl checked inside fetchOgDescription
      const d = await fetchOgDescription(a.link);
      if (d) a.description = d.slice(0, 2000);
    }));
  }

  // Final sanitization pass before sending to client
  const safeItems = items.map(a => ({
    id:          stripHtml(a.id).slice(0, 2048),
    title:       stripHtml(a.title).slice(0, 500),
    link:        /^https:\/\//.test(stripHtml(a.link)) ? stripHtml(a.link).slice(0, 2048) : '',
    description: stripHtml(a.description).slice(0, 2000),
    pubDate:     a.pubDate,
    source:      stripHtml(a.source).slice(0, 50),
    sourceLabel: stripHtml(a.sourceLabel).slice(0, 100),
    badgeClass:  VALID_BADGE_CLASSES.has(a.badgeClass) ? a.badgeClass : '',
  }));

  res.status(200).json({ status: 'ok', items: safeItems });
};
