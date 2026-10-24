// Vercel function for /p/:slug. Fetches the pass from the Worker, then:
// - crawler UA: returns OG-only HTML so share previews carry the pass name,
//   bio, and avatar;
// - human UA: returns index.html with per-pass OG meta injected plus the
//   server state. The visit is recorded by a client beacon (see index.html
//   server mode), never by awaiting a Worker call here, so a slow stats
//   write cannot delay the page.
const API = 'https://linkpass-api.fleursmeron-id.workers.dev';
const SITE = 'https://linkpass.xsrazy.web.id';
const CRAWLERS = ['facebookexternalhit', 'twitterbot', 'whatsapp', 'telegrambot', 'linkedinbot', 'slackbot', 'discordbot', 'facebot', 'ia_archiver', 'pinterestbot', 'googlebot', 'bingbot', 'applebot', 'duckduckbot', 'yandexbot', 'baiduspider'];
const BOT_WORDS = ['bot', 'crawler', 'spider', 'crawling'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function simplePage(res, status, title, msg) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send('<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' | LinkPass</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#101014;color:#f4f1e8;font-family:system-ui,sans-serif;text-align:center;padding:24px"><div><h1>' + title + '</h1><p style="color:#a3a099">' + msg + '</p><p><a href="/" style="color:#c8ff3d">Buat pass baru di LinkPass</a></p></div></body></html>');
}

function notFound(res) {
  return simplePage(res, 404, 'Pass tidak ditemukan', 'Short link ini tidak ada atau sudah dinonaktifkan.');
}

// A backend failure is not a missing pass: answer 502 with a clear message.
function backendError(res) {
  return simplePage(res, 502, 'LinkPass sedang bermasalah', 'Server LinkPass sedang bermasalah sesaat. Coba lagi beberapa saat lagi, pass kamu tidak hilang.');
}

function replaceMeta(html, attr, value) {
  const re = new RegExp('(<meta (?:property|name)="' + attr + '" content=")[^"]*(")');
  // Replacer function form: the returned string is used literally, so a
  // value containing $&, $', $` or $n cannot inject the old match.
  return html.replace(re, (m, g1, g2) => g1 + esc(value) + g2);
}

module.exports = async (req, res) => {
  const slug = String((req.query && req.query.slug) || '');
  if (!/^[a-z0-9]{6}$/.test(slug)) return notFound(res);
  let passRes;
  try {
    passRes = await fetch(API + '/passes/' + slug, { signal: AbortSignal.timeout(5000) });
  } catch {
    return backendError(res);
  }
  if (passRes.status === 404) return notFound(res);
  if (!passRes.ok) return backendError(res);
  let data;
  try {
    data = await passRes.json();
  } catch {
    return backendError(res);
  }
  const st = data.state || {};
  const title = (st.name ? st.name + ' | LinkPass' : 'LinkPass');
  const desc = st.bio || 'Kartu digital untuk semua linkmu';
  const pageUrl = SITE + '/p/' + slug;
  // Versioned by updated_at so a changed avatar is reflected immediately;
  // the versioned URL keeps its long public cache lifetime.
  const avatarVersion = data.updated_at ? Date.parse(data.updated_at) : 0;
  const ogImage = (typeof st.avatar === 'string' && st.avatar.startsWith('data:'))
    ? API + '/passes/' + slug + '/avatar?v=' + avatarVersion
    : SITE + '/assets/og-image.png?v=3';
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  const isCrawler = CRAWLERS.some((c) => ua.includes(c)) || BOT_WORDS.some((w) => ua.includes(w));

  if (isCrawler) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const links = (st.links || []).map((l) => '<li><a href="' + esc(l.url) + '">' + esc(l.title || 'Link') + '</a></li>').join('');
    return res.status(200).send('<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + esc(title) + '</title><meta name="description" content="' + esc(desc) + '">' +
      '<link rel="canonical" href="' + pageUrl + '">' +
      '<meta property="og:type" content="website"><meta property="og:site_name" content="LinkPass">' +
      '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '">' +
      '<meta property="og:url" content="' + pageUrl + '"><meta property="og:image" content="' + esc(ogImage) + '">' +
      '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + esc(title) + '">' +
      '<meta name="twitter:description" content="' + esc(desc) + '"><meta name="twitter:image" content="' + esc(ogImage) + '">' +
      '</head><body><h1>' + esc(st.name || 'LinkPass') + '</h1><p>' + esc(desc) + '</p><ul>' + links + '</ul>' +
      '<p><a href="' + pageUrl + '">Buka pass</a></p></body></html>');
  }

  // Human visitor: serve the full app with server state right away. The
  // visit is recorded by a client beacon in server mode (index.html), so
  // this function never waits on a stats write.
  const fs = require('fs');
  const path = require('path');
  let html = null;
  for (const candidate of [path.join(__dirname, '..', 'index.html'), path.join(process.cwd(), 'index.html')]) {
    try {
      if (fs.existsSync(candidate)) { html = fs.readFileSync(candidate, 'utf8'); break; }
    } catch {}
  }
  if (!html) return backendError(res);
  html = html.replace(/<title>[^<]*<\/title>/, () => '<title>' + esc(title) + '</title>');
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, (m, g1, g2) => g1 + esc(desc) + g2);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, (m, g1, g2) => g1 + pageUrl + g2);
  html = replaceMeta(html, 'og:title', title);
  html = replaceMeta(html, 'og:description', desc);
  html = replaceMeta(html, 'og:url', pageUrl);
  html = replaceMeta(html, 'og:image', ogImage);
  html = replaceMeta(html, 'twitter:title', title);
  html = replaceMeta(html, 'twitter:description', desc);
  html = replaceMeta(html, 'twitter:image', ogImage);
  const boot = '<script>window.__LINKPASS_SERVER_STATE__=' + JSON.stringify(st).replace(/</g, '\\u003c') +
    ';window.__LINKPASS_SERVER_SLUG__=' + JSON.stringify(slug) +
    ';window.__LINKPASS_API_URL=' + JSON.stringify(API) + ';</script>';
  const marker = '<script>\nconst $=';
  const idx = html.indexOf(marker);
  if (idx >= 0) html = html.slice(0, idx) + boot + '\n' + html.slice(idx);
  else {
    const last = html.lastIndexOf('<script>');
    html = last >= 0 ? html.slice(0, last) + boot + '\n' + html.slice(last) : html + boot;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
};
