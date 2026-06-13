# Samachar

**Live → [samachar.pages.dev](https://samachar.pages.dev/)**

Ad-free Indian news aggregator built for UPSC prep. Pulls from The Hindu, Indian Express, BBC Hindi, and Dainik Bhaskar via RSS. PWA — works offline.

![License](https://img.shields.io/badge/license-MIT-orange)

## Stack

- Vanilla JS + HTML + CSS (no framework, no build step)
- Vercel Serverless Function — RSS aggregation, rate limiting, caching
- Service Worker — offline support, network-first for API

## Local Dev

**Prerequisites:** [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`)

```bash
git clone https://github.com/OmDoshii/Samachar.git
cd samachar
vercel dev
```

Opens at `http://localhost:3000`. The `/api/news` serverless function runs locally via Vercel CLI — no extra setup needed.

> Without Vercel CLI you can open `index.html` directly in a browser, but the news API won't work (CORS). Use a local proxy or just use `vercel dev`.

## Deploy

```bash
vercel
```

That's it. Headers and caching are configured in `vercel.json`.

## Project Structure

```
samachar/
├── index.html        # SPA shell
├── app.js            # All frontend logic
├── style.css         # All styles
├── sw.js             # Service worker
├── manifest.json     # PWA manifest
├── api/
│   └── news.js       # Serverless function — RSS fetch + parse
├── icons/            # PWA icons
└── vercel.json       # Deployment + security headers
```

## Contributing

PRs welcome. A few things to keep in mind:

- No build tools, no npm — keep it that way
- All user-facing content from RSS goes through `eh()` (HTML escape) before rendering — don't bypass it
- New news sources go in `RSS_FEEDS` in `api/news.js`; add a corresponding `badge-*` class in `style.css`
- Bump `CACHE` version in `sw.js` if you change `style.css`, `app.js`, or `index.html`

## License

MIT — Om Doshi 2026
