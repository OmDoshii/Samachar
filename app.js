const CATEGORIES = ['All','History','Geography','Polity','Economy','Environment','Science','Finance','Sports','Entertainment','Current Affairs'];
const PER_PAGE = 8;
const RECENT_HOURS = 6;
const SERVER = '';

let allArticles = [];
let readSet = (() => { try { return new Set(JSON.parse(localStorage.getItem('samachar_read') || '[]')); } catch { return new Set(); } })();
let activeFilter = 'All';
let currentPage = 1;
let stackIdx = 0;
let stackHistory = [];
let showCaughtUp = false;
let currentLang = (() => { const l = localStorage.getItem('samachar_lang'); return l === 'hi' ? 'hi' : 'en'; })();

// ── Helpers ───────────────────────────────────────────────────────────────
function saveRead() { localStorage.setItem('samachar_read', JSON.stringify([...readSet])); }

function formatTime(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date)) return '';
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yest  = new Date(today - 86400000);
  const day   = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const t     = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (day.getTime() === today.getTime()) return 'Today, ' + t;
  if (day.getTime() === yest.getTime())  return 'Yesterday, ' + t;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + t;
}
function isRecent(d) { return d && (Date.now() - new Date(d)) < RECENT_HOURS * 3600000; }

function guessCategory(title, desc) {
  const t = (title + ' ' + desc).toLowerCase();
  if (/history|heritage|ancient|medieval|mughal|colonial|freedom fighter|independence|partition|archaeological|monument/.test(t)) return 'History';
  if (/geography|river|mountain|monsoon|terrain|coastal|delta|plateau|drought|flood|earthquake|cyclone/.test(t)) return 'Geography';
  if (/constitution|parliament|election|supreme court|judiciary|legislation|bill passed|lok sabha|rajya sabha|governor|amendment|fundamental rights/.test(t)) return 'Polity';
  if (/economy|gdp|inflation|rbi|budget|fiscal|trade deficit|growth rate|rupee|export|import|wto|imf|world bank/.test(t)) return 'Economy';
  if (/environment|forest|wildlife|pollution|climate change|carbon|emission|biodiversity|species|wetland|tiger|national park|solar|renewable/.test(t)) return 'Environment';
  if (/science|technology|space|isro|nasa|research|discovery|innovation|artificial intelligence|satellite|nuclear|vaccine|disease|genome|quantum/.test(t)) return 'Science';
  if (/stock|sensex|nifty|sebi|insurance|mutual fund|npa|interest rate|gst|income tax|direct tax|bond|ipo/.test(t)) return 'Finance';
  if (/cricket|ipl|\bbcci\b|\bt20\b|test match|\bodi\b|\bicc\b|world cup|virat kohli|rohit sharma|ms dhoni|jasprit bumrah|shubman gill|\btennis\b|wimbledon|us open|french open|australian open|djokovic|carlos alcaraz|\bbadminton\b|pv sindhu|saina nehwal|kidambi srikanth|\bfifa\b|\bisl\b|premier league|bundesliga|champions league|la liga|hockey india|\bfih\b|pro kabaddi|\bkabaddi\b|\bolympics\b|\bparalympics\b|asian games|commonwealth games|gold medal|silver medal|bronze medal|neeraj chopra|mary kom|bajrang punia|chess olympiad|chess championship|boxing championship|boxing title|wrestling championship|athletics championship|\bgolf\b/.test(t)) return 'Sports';
  if (/bollywood|box.?office|national film award|filmfare|\biifa\b|\boscars?\b|\bbafta\b|golden globe|\bott\b|\bnetflix\b|amazon prime video|disney\+|hotstar|zee5|sony liv|\bbigg boss\b|reality show|web series|music album|\bgrammy\b|film director|movie release|film release|television serial|entertainment industry|celebrity|blockbuster|streaming platform|trailer launch|award ceremony/.test(t)) return 'Entertainment';
  return 'Current Affairs';
}

// ── Escape helpers ────────────────────────────────────────────────────────
function eh(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function ea(s) { return eh(s); }
function safeUrl(s) { const u = String(s).trim(); return /^https?:\/\//i.test(u) ? ea(u) : '#'; }

// ── Language ──────────────────────────────────────────────────────────────
function setLang(lang) {
  if (lang === currentLang) return;
  currentLang = lang;
  localStorage.setItem('samachar_lang', lang);
  activeFilter = 'All';
  currentPage = 1; stackIdx = 0; stackHistory = []; showCaughtUp = false;
  renderLangToggle();
  renderFilters();
  updateFooter();
  loadAll();
}
function renderLangToggle() {
  document.getElementById('langToggle').innerHTML =
    `<button class="lang-btn${currentLang === 'en' ? ' active' : ''}" data-lang="en">EN</button>` +
    `<button class="lang-btn${currentLang === 'hi' ? ' active' : ''}" data-lang="hi">हिं</button>`;
}
function updateFooter() {
  const el = document.getElementById('footerSources');
  if (currentLang === 'hi') {
    el.innerHTML = 'समाचार स्रोत: <a href="https://www.bbc.com/hindi" target="_blank" rel="noopener noreferrer">BBC हिंदी</a> &amp; <a href="https://www.bhaskar.com" target="_blank" rel="noopener noreferrer">दैनिक भास्कर</a>';
  } else {
    el.innerHTML = 'News sourced from <a href="https://www.thehindu.com" target="_blank" rel="noopener noreferrer">The Hindu</a> &amp; <a href="https://indianexpress.com" target="_blank" rel="noopener noreferrer">Indian Express</a>';
  }
}

// ── Load ──────────────────────────────────────────────────────────────────
async function loadAll() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning'); btn.disabled = true;
  showLoading();
  try {
    const res = await fetch(SERVER + '/api/news?lang=' + currentLang);
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const data = await res.json();
    const seen = new Set();
    allArticles = (data.items || [])
      .filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; })
      .map(a => ({ ...a, category: currentLang === 'hi' ? '' : guessCategory(a.title, a.description) }));
    document.getElementById('lastUpdated').textContent =
      'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    currentPage = 1; stackIdx = 0; stackHistory = []; showCaughtUp = false;
    renderCards();
  } catch (e) {
    showError(e.message);
  }
  btn.classList.remove('spinning'); btn.disabled = false;
}

// ── Filter ────────────────────────────────────────────────────────────────
function getFiltered() { return activeFilter === 'All' ? allArticles : allArticles.filter(a => a.category === activeFilter); }
function setFilter(cat) { activeFilter = cat; currentPage = 1; stackIdx = 0; stackHistory = []; showCaughtUp = false; renderFilters(); renderCards(); }
function renderFilters() {
  const cats = currentLang === 'hi' ? ['All'] : CATEGORIES;
  document.getElementById('filterRow').innerHTML = cats.map(c =>
    `<button class="pill${c === activeFilter ? ' active' : ''}" data-cat="${eh(c)}">${eh(c)}</button>`
  ).join('');
}

// ── Read state ────────────────────────────────────────────────────────────
function markRead(id) {
  readSet.add(id); saveRead();
  const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (card) { card.classList.remove('unread'); const nb = card.querySelector('.new-badge'); if (nb) nb.remove(); }
  updateUnreadPill();
}
function updateUnreadPill() {
  const n = getFiltered().filter(a => !readSet.has(a.id)).length;
  const el = document.getElementById('unreadPill');
  if (n > 0) { el.removeAttribute('hidden'); el.textContent = n + ' unread'; } else el.setAttribute('hidden', '');
}

// ── Render ────────────────────────────────────────────────────────────────
function renderCards() {
  const filtered = getFiltered(), total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;
  document.getElementById('sectionLabel').textContent = activeFilter === 'All'
    ? (currentLang === 'hi' ? 'सभी समाचार' : 'All categories')
    : activeFilter;
  updateUnreadPill();
  const content = document.getElementById('content');
  if (!total) {
    content.innerHTML = `<div class="state-wrap"><div class="state-title">No articles found</div><div class="state-sub">Try a different category or hit Refresh.</div></div>`;
    return;
  }
  const pageItems = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);
  const cards = pageItems.map((a) => {
    const unread = !readSet.has(a.id), recent = isRecent(a.pubDate), showNew = unread && recent;
    const showCat = currentLang === 'en' && a.category;
    return `<article class="card${unread ? ' unread' : ''}" data-id="${ea(a.id)}" data-link="${ea(a.link)}">
      <div class="card-top">
        <div class="badges">
          <span class="badge ${eh(a.badgeClass)}">${eh(a.sourceLabel)}</span>
          ${showCat ? `<span class="badge badge-cat">${eh(a.category)}</span>` : ''}
        </div>
        ${showNew ? '<span class="new-badge"><span class="new-dot"></span>NEW</span>' : ''}
      </div>
      <div class="card-title">${eh(a.title)}</div>
      ${a.description
        ? `<div class="card-summary">${eh(a.description)}</div>`
        : `<div class="card-summary card-summary-empty">No preview — click to read full article</div>`
      }
      <div class="card-footer">
        <span class="card-time">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${formatTime(a.pubDate)}
        </span>
        <a class="read-link" href="${safeUrl(a.link)}" target="_blank" rel="noopener noreferrer" data-id="${ea(a.id)}">
          Read full
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
      </div>
    </article>`;
  }).join('');

  let pg = '';
  if (totalPages > 1) {
    pg = `<div class="pagination"><button class="page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>← Prev</button>`;
    for (let i = 1; i <= totalPages; i++) {
      if (totalPages <= 7 || i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1)
        pg += `<button class="page-btn${i === currentPage ? ' active' : ''}" data-page="${i}">${i}</button>`;
      else if (Math.abs(i - currentPage) === 2)
        pg += '<span class="page-ellipsis">…</span>';
    }
    pg += `<button class="page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>Next →</button></div>`;
  }
  content.innerHTML = `<div class="grid">${cards}</div>${pg}`;

  // Set staggered animation delays via JS (avoids inline style attributes in HTML)
  content.querySelectorAll('.card').forEach((card, i) => {
    card.style.animationDelay = (i * 0.04) + 's';
  });

  renderMobileStack();
}

function changePage(p) {
  const tp = Math.ceil(getFiltered().length / PER_PAGE);
  if (p < 1 || p > tp) return;
  currentPage = p; renderCards(); window.scrollTo({ top: 0, behavior: 'smooth' });
}
function handleClick(id, link) { markRead(id); if (/^https?:\/\//i.test(link)) window.open(link, '_blank', 'noopener,noreferrer'); }

// ── State screens ─────────────────────────────────────────────────────────
function showLoading() {
  const sources = currentLang === 'hi' ? 'BBC हिंदी and दैनिक भास्कर' : 'The Hindu and Indian Express';
  const ms = document.getElementById('mobileStack');
  if (ms) ms.innerHTML = '';
  document.getElementById('content').innerHTML = `<div class="state-wrap">
    <div class="spinner"></div>
    <div class="state-title">Fetching latest news…</div>
    <div class="state-sub">Pulling from ${eh(sources)}</div>
  </div>`;
}
function showError(msg) {
  document.getElementById('content').innerHTML = `<div class="state-wrap"><div class="error-box">
    <strong>Could not fetch news</strong>
    The news API is temporarily unavailable. Please wait a moment and hit Refresh.<br><br>
    <span class="error-detail">Error: ${eh(msg || 'Request failed')}</span>
  </div></div>`;
}

// ── Mobile card stack ────────────────────────────────────────────────────
function cardHTML(a) {
  const unread = !readSet.has(a.id), recent = isRecent(a.pubDate), showNew = unread && recent;
  const showCat = currentLang === 'en' && a.category;
  return `
    <div class="card-top">
      <div class="badges">
        <span class="badge ${eh(a.badgeClass)}">${eh(a.sourceLabel)}</span>
        ${showCat ? `<span class="badge badge-cat">${eh(a.category)}</span>` : ''}
      </div>
      ${showNew ? '<span class="new-badge"><span class="new-dot"></span>NEW</span>' : ''}
    </div>
    <div class="card-title">${eh(a.title)}</div>
    ${a.description
      ? `<div class="card-summary">${eh(a.description)}</div>`
      : `<div class="card-summary card-summary-empty">No preview — tap Read full</div>`
    }
    <div class="card-footer">
      <span class="card-time">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${formatTime(a.pubDate)}
      </span>
      <a class="read-link" href="${safeUrl(a.link)}" target="_blank" rel="noopener noreferrer" data-id="${ea(a.id)}">
        Read full
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>
    </div>
    <div class="swipe-hint">↑ next &nbsp;·&nbsp; ↓ go back</div>`;
}

function renderMobileStack() {
  const el = document.getElementById('mobileStack');
  if (!el) return;
  const filtered = getFiltered();
  if (!filtered.length) { el.innerHTML = ''; return; }

  if (showCaughtUp) {
    const totalNew = filtered.filter(a => isRecent(a.pubDate)).length;
    const older = filtered.length - stackIdx;
    el.innerHTML = `
      <div class="scard-behind scard-b2"></div>
      <div class="scard-behind scard-b1"></div>
      <div class="scard scard-done" id="topScard">
        <div class="done-icon">✓</div>
        <div class="done-title">All new articles read!</div>
        <div class="done-sub">You're caught up on today's news.<br>${older > 0 ? `Swipe ↑ to browse ${older} older article${older !== 1 ? 's' : ''} · ↓ to reread last` : 'Swipe ↓ to reread · refresh for latest news'}</div>
        ${older === 0 ? `<button class="refresh-btn done-refresh js-load-all">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Refresh for latest
        </button>` : ''}
      </div>
      <div class="stack-counter">${totalNew} new read · ${older} older remaining</div>`;
    attachSpecialSwipe(
      document.getElementById('topScard'),
      older > 0 ? () => { showCaughtUp = false; renderMobileStack(); } : null,
      stackHistory.length > 0 ? () => { showCaughtUp = false; stackIdx = stackHistory.pop(); renderMobileStack(); } : null
    );
    return;
  }

  if (stackIdx >= filtered.length) {
    el.innerHTML = `
      <div class="scard-behind scard-b2"></div>
      <div class="scard-behind scard-b1"></div>
      <div class="scard scard-done" id="topScard">
        <div class="done-icon">✓</div>
        <div class="done-title">That's everything!</div>
        <div class="done-sub">You've browsed all ${filtered.length} articles.<br>Swipe ↓ to go back or refresh for latest.</div>
        <button class="refresh-btn done-refresh js-load-all">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Refresh for latest
        </button>
      </div>
      <div class="stack-counter">${filtered.length} / ${filtered.length}</div>`;
    attachSpecialSwipe(
      document.getElementById('topScard'),
      null,
      stackHistory.length > 0 ? () => { stackIdx = stackHistory.pop(); renderMobileStack(); } : null
    );
    return;
  }

  const a = filtered[stackIdx];
  const unread = !readSet.has(a.id);

  el.innerHTML = `
    <div class="scard-behind scard-b2"></div>
    <div class="scard-behind scard-b1"></div>
    <div class="scard${unread ? ' unread' : ''}" id="topScard" data-id="${ea(a.id)}" data-link="${ea(a.link)}">
      ${cardHTML(a)}
    </div>
    <div class="stack-counter">${stackIdx + 1} / ${filtered.length}</div>`;

  attachSwipe(document.getElementById('topScard'), filtered, a);
}

let _ty0 = 0, _tx0 = 0, _dragging = false;

function attachSpecialSwipe(card, onUp, onDown) {
  let ty0 = 0, dragging = false;
  card.addEventListener('touchstart', e => {
    ty0 = e.touches[0].clientY; dragging = true; card.style.transition = 'none';
  }, { passive: true });
  card.addEventListener('touchmove', e => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - ty0;
    e.preventDefault();
    card.style.transform = `translateY(${dy}px) rotate(${dy * 0.04}deg)`;
  }, { passive: false });
  card.addEventListener('touchend', e => {
    if (!dragging) return;
    dragging = false;
    const dy = e.changedTouches[0].clientY - ty0;
    if (dy < -70 && onUp) {
      card.style.transition = 'transform .3s ease, opacity .3s ease';
      card.style.transform = 'translateY(-110vh) rotate(-8deg)';
      card.style.opacity = '0';
      setTimeout(onUp, 280);
    } else if (dy > 70 && onDown) {
      card.style.transition = 'transform .3s ease, opacity .3s ease';
      card.style.transform = 'translateY(110vh) rotate(8deg)';
      card.style.opacity = '0';
      setTimeout(onDown, 280);
    } else {
      card.style.transition = 'transform .25s ease';
      card.style.transform = 'translateY(0) rotate(0)';
    }
  });
}

function attachSwipe(card, filtered, a) {
  card.addEventListener('touchstart', e => {
    _ty0 = e.touches[0].clientY;
    _tx0 = e.touches[0].clientX;
    _dragging = true;
    card.style.transition = 'none';
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    if (!_dragging) return;
    const dy = e.touches[0].clientY - _ty0;
    const dx = e.touches[0].clientX - _tx0;
    if (Math.abs(dy) > Math.abs(dx)) {
      e.preventDefault();
      card.style.transform = `translateY(${dy}px) rotate(${dy * 0.04}deg)`;
    }
  }, { passive: false });

  card.addEventListener('touchend', e => {
    if (!_dragging) return;
    _dragging = false;
    const dy = e.changedTouches[0].clientY - _ty0;
    const THRESHOLD = 70;

    if (dy < -THRESHOLD && stackIdx < filtered.length) {
      const wasNew = !readSet.has(a.id);
      markRead(a.id);
      card.style.transition = 'transform .3s ease, opacity .3s ease';
      card.style.transform = 'translateY(-110vh) rotate(-8deg)';
      card.style.opacity = '0';
      stackHistory.push(stackIdx);
      stackIdx++;
      if (wasNew && getFiltered().filter(x => !readSet.has(x.id)).length === 0) {
        showCaughtUp = true;
      }
      setTimeout(renderMobileStack, 280);
    } else if (dy > THRESHOLD && stackHistory.length > 0) {
      card.style.transition = 'transform .3s ease, opacity .3s ease';
      card.style.transform = 'translateY(110vh) rotate(8deg)';
      card.style.opacity = '0';
      stackIdx = stackHistory.pop();
      setTimeout(renderMobileStack, 280);
    } else {
      card.style.transition = 'transform .25s ease';
      card.style.transform = 'translateY(0) rotate(0)';
    }
  });
}

// ── Event delegation (replaces all onclick attributes) ────────────────────
document.addEventListener('click', e => {
  // Lang toggle
  const langBtn = e.target.closest('[data-lang]');
  if (langBtn && document.getElementById('langToggle').contains(langBtn)) {
    setLang(langBtn.dataset.lang); return;
  }
  // Category filter
  const catBtn = e.target.closest('[data-cat]');
  if (catBtn && document.getElementById('filterRow').contains(catBtn)) {
    setFilter(catBtn.dataset.cat); return;
  }
  // Pagination
  const pageBtn = e.target.closest('[data-page]');
  if (pageBtn && document.getElementById('content').contains(pageBtn)) {
    const p = parseInt(pageBtn.dataset.page, 10);
    if (!isNaN(p)) changePage(p);
    return;
  }
  // Read link — must check before card click to stop propagation
  const readLink = e.target.closest('.read-link');
  if (readLink) {
    e.stopPropagation();
    const id = readLink.dataset.id;
    if (id) markRead(id);
    return;
  }
  // Card click (desktop grid)
  const card = e.target.closest('.card[data-id]');
  if (card) {
    const id = card.dataset.id;
    const link = card.dataset.link;
    if (id && link) handleClick(id, link);
    return;
  }
  // Refresh buttons inside mobile done-cards
  if (e.target.closest('.js-load-all')) { loadAll(); return; }
});

// Static refresh button
document.getElementById('refreshBtn').addEventListener('click', loadAll);

// ── Init ──────────────────────────────────────────────────────────────────
renderLangToggle();
renderFilters();
updateFooter();
loadAll();
setInterval(() => { if (document.visibilityState === 'visible') loadAll(); }, 15 * 60 * 1000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
