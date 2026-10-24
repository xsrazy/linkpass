// LinkPass API worker: D1-backed backend for linkpass.xsrazy.web.id.
// v1 rules: no end user login, a secret manage token is the only edit key,
// admin access uses the ADMIN_KEY secret. No email is ever sent in v1.

const PUBLIC_ORIGIN = 'https://linkpass.xsrazy.web.id';
const SITE_URL = 'https://linkpass.xsrazy.web.id';
const SKINS = ['backstage', 'boarding', 'vinyl', 'arcade', 'receipt', 'botanical', 'ktp', 'paspor', 'bioskop'];
const FONTS = ['archivo', 'jakarta', 'bebas', 'playfair', 'mono', 'caveat'];
const HEXRE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const MAX_AVATAR_BYTES = 25600;
// Raster only. SVG is rejected on purpose: an SVG avatar can carry active
// script, and the avatar endpoint would serve it from the Worker origin.
const AVATAR_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function avatarMime(dataUrl) {
  if (typeof dataUrl !== 'string') return '';
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  return m ? m[1].toLowerCase() : '';
}

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '';
  if (origin === PUBLIC_ORIGIN || origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:')) {
    return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, x-manage-token, x-admin-key', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Vary': 'Origin' };
  }
  return {};
}

function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(req) } });
}

function err(req, status, message) {
  return json(req, { error: message }, status);
}

function hasBadKey(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (BAD_KEYS.has(key)) return true;
    if (hasBadKey(value[key], seen)) return true;
  }
  return false;
}

function normUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  return /^(https?:|mailto:|tel:)/i.test(u) ? u : 'https://' + u;
}

function urlOk(u) {
  try {
    const p = new URL(normUrl(u));
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(p.protocol) && p.hostname !== '';
  } catch {
    return false;
  }
}

function avatarBytes(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return -1;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return -1;
  return Math.floor((dataUrl.length - comma - 1) * 3 / 4);
}

function str(v, max) {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

// Returns { state, dropped } or throws an Error with a user-facing message.
function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Data pass tidak valid');
  if (hasBadKey(raw)) throw new Error('Data pass tidak valid');
  const avatar = typeof raw.avatar === 'string' ? raw.avatar : '';
  if (avatar) {
    if (!AVATAR_MIMES.has(avatarMime(avatar))) throw new Error('Foto harus berupa JPG, PNG, WebP, atau GIF');
    if (avatarBytes(avatar) > MAX_AVATAR_BYTES) throw new Error('Foto melebihi batas 25 KB');
  }
  let dropped = 0;
  const links = [];
  if (!Array.isArray(raw.links)) throw new Error('Daftar link tidak valid');
  if (raw.links.length > 50) throw new Error('Terlalu banyak link');
  for (const l of raw.links) {
    if (!l || typeof l !== 'object' || Array.isArray(l) || hasBadKey(l)) throw new Error('Daftar link tidak valid');
    const url = typeof l.url === 'string' ? l.url.trim() : '';
    if (!url || !urlOk(url)) { dropped++; continue; }
    links.push({
      icon: str(l.icon, 10),
      title: str(l.title, 200),
      note: str(l.note, 300),
      url,
      hot: !!l.hot,
    });
  }
  return {
    state: {
      name: str(raw.name, 200),
      username: str(raw.username, 200),
      role: str(raw.role, 200),
      bio: str(raw.bio, 1000),
      location: str(raw.location, 200),
      avatar,
      accent: (typeof raw.accent === 'string' && HEXRE.test(raw.accent)) ? raw.accent : '#c8ff3d',
      skin: SKINS.includes(raw.skin) ? raw.skin : 'backstage',
      font: FONTS.includes(raw.font) ? raw.font : 'archivo',
      sharePhoto: typeof raw.sharePhoto === 'boolean' ? raw.sharePhoto : true,
      stats: typeof raw.stats === 'boolean' ? raw.stats : true,
      stub: typeof raw.stub === 'boolean' ? raw.stub : true,
      links,
    },
    dropped,
  };
}

function publicState(row) {
  const state = JSON.parse(row.state);
  state.avatar = row.avatar || '';
  return state;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomSlug() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => SLUG_CHARS[b % SLUG_CHARS.length]).join('');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function uuid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

async function getPass(env, slug) {
  return env.DB.prepare('SELECT * FROM passes WHERE slug = ?').bind(slug).first();
}

async function requireManage(env, req, row) {
  const token = req.headers.get('x-manage-token') || '';
  if (!token) return false;
  return timingEqual(await sha256Hex(token), row.manage_token_hash);
}

async function requireAdmin(env, req) {
  const key = req.headers.get('x-admin-key') || '';
  if (!key || !env.ADMIN_KEY) return false;
  return timingEqual(await sha256Hex(key), await sha256Hex(env.ADMIN_KEY));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      if (path === '/health') return json(req, { ok: true });
      if (path === '/manage-resolve' && req.method === 'GET') {
        const token = req.headers.get('x-manage-token') || '';
        if (!token) return err(req, 403, 'Link kelola tidak valid');
        const row = await env.DB.prepare('SELECT * FROM passes WHERE manage_token_hash = ?').bind(await sha256Hex(token)).first();
        if (!row) return err(req, 404, 'Pass tidak ditemukan');
        // A disabled pass stays visible to its owner here (with a disabled
        // flag), while the public page and public API still answer 404.
        return json(req, { slug: row.slug, state: publicState(row), disabled: !!row.disabled, hasRecoveryEmail: !!row.recovery_email, created_at: row.created_at, updated_at: row.updated_at });
      }

      // ---- Public pass reads ----
      if (path === '/passes' && req.method === 'POST') return this.createPass(req, env);
      const passMatch = path.match(/^\/passes\/([a-z0-9-]+)(?:\/(avatar|stats|visit|click|recover))?$/);
      if (passMatch) {
        const slug = passMatch[1];
        const sub = passMatch[2] || '';
        if (sub === 'avatar' && req.method === 'GET') return this.avatar(req, env, slug);
        if (sub === 'stats' && req.method === 'GET') return this.passStats(req, env, slug);
        if (sub === 'visit' && req.method === 'POST') return this.visit(req, env, slug);
        if (sub === 'click' && req.method === 'POST') return this.click(req, env, slug);
        if (sub === 'recover' && req.method === 'POST') return this.recover(req, env, slug);
        if (!sub && req.method === 'GET') return this.getPublic(req, env, slug);
        if (!sub && req.method === 'PUT') return this.updatePass(req, env, slug);
        if (!sub && req.method === 'DELETE') return this.deletePass(req, env, slug);
      }

      // ---- Admin ----
      if (path.startsWith('/admin/')) return this.admin(req, env, path);

      return err(req, 404, 'Rute tidak ditemukan');
    } catch (e) {
      console.log('linkpass-api error:', e && e.message);
      return err(req, 500, 'Terjadi kesalahan server');
    }
  },

  async createPass(req, env) {
    let body;
    try { body = await req.json(); } catch { return err(req, 400, 'Body JSON tidak valid'); }
    let clean;
    try { clean = sanitizeState(body.state); } catch (e) { return err(req, 400, e.message); }
    let recoveryEmail = null;
    if (body.recovery_email !== undefined && body.recovery_email !== null && body.recovery_email !== '') {
      if (typeof body.recovery_email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.recovery_email)) {
        return err(req, 400, 'Email pemulihan tidak valid');
      }
      recoveryEmail = body.recovery_email.trim().toLowerCase();
    }
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await sha256Hex('linkpass-ip:' + ip);
    const cutoff = new Date(Date.now() - 3600 * 1000).toISOString();
    const recent = await env.DB.prepare('SELECT COUNT(*) AS c FROM passes WHERE creator_ip_hash = ? AND created_at > ?').bind(ipHash, cutoff).first();
    if (recent && recent.c >= 20) return err(req, 429, 'Terlalu banyak pass dibuat dalam satu jam, coba lagi nanti');
    // Second layer: a loose global cap plus a minimum gap per IP. A rotating
    // IP can still pass the per-IP limit, but a flood now also has to clear
    // the global cap, and a single IP cannot burst faster than one pass per
    // 5 seconds. Residual risk (rotating IPs under the global cap) is real
    // and documented in the fix notes.
    const globalRecent = await env.DB.prepare('SELECT COUNT(*) AS c FROM passes WHERE created_at > ?').bind(cutoff).first();
    if (globalRecent && globalRecent.c >= 300) return err(req, 429, 'Pembuatan pass sedang dibatasi karena lonjakan, coba lagi nanti');
    const last = await env.DB.prepare('SELECT created_at FROM passes WHERE creator_ip_hash = ? ORDER BY created_at DESC LIMIT 1').bind(ipHash).first();
    if (last && Date.now() - Date.parse(last.created_at) < 5000) return err(req, 429, 'Terlalu cepat, tunggu beberapa detik lalu coba lagi');
    let slug = '';
    for (let i = 0; i < 10; i++) {
      slug = randomSlug();
      const exists = await env.DB.prepare('SELECT 1 FROM passes WHERE slug = ?').bind(slug).first();
      if (!exists) break;
      if (i === 9) return err(req, 500, 'Gagal membuat kode pass, coba lagi');
    }
    const token = randomToken();
    const now = nowIso();
    await env.DB.prepare(
      'INSERT INTO passes (id, slug, state, avatar, recovery_email, manage_token_hash, disabled, creator_ip_hash, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)'
    ).bind(uuid(), slug, JSON.stringify(clean.state), clean.state.avatar, recoveryEmail, await sha256Hex(token), ipHash, now, now, now).run();
    return json(req, {
      slug,
      publicUrl: SITE_URL + '/p/' + slug,
      manageUrl: SITE_URL + '/manage/' + token,
      dropped: clean.dropped,
    }, 201);
  },

  async getPublic(req, env, slug) {
    const row = await getPass(env, slug);
    if (!row || row.disabled) return err(req, 404, 'Pass tidak ditemukan');
    return json(req, { slug: row.slug, state: publicState(row), created_at: row.created_at, updated_at: row.updated_at });
  },

  async avatar(req, env, slug) {
    const row = await getPass(env, slug);
    if (!row || row.disabled || !row.avatar) return new Response('Not found', { status: 404 });
    const mime = avatarMime(row.avatar);
    if (!AVATAR_MIMES.has(mime)) return new Response('Not found', { status: 404 });
    const comma = row.avatar.indexOf(',');
    const b64 = row.avatar.slice(comma + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // nosniff plus a sandbox CSP so a served image can never run as a page.
    return new Response(bytes, { headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  },

  // Stats are best effort and deduped: one count per IP per pass per day
  // (per link for clicks). Returns true only when this is a new count.
  // A stats-write failure must never surface as an error to the visitor.
  async recordStat(env, req, row, kind, key) {
    try {
      const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
      const ipHash = await sha256Hex('linkpass-ip:' + ip);
      const day = nowIso().slice(0, 10);
      const dedupe = await env.DB.prepare(
        'INSERT OR IGNORE INTO stat_events (pass_id, kind, dedupe_key, ip_hash, day, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(row.id, kind, key, ipHash, day, nowIso()).run();
      if (!dedupe.meta || dedupe.meta.changes !== 1) return false;
      return true;
    } catch {
      return false;
    }
  },

  async visit(req, env, slug) {
    const row = await getPass(env, slug);
    if (!row || row.disabled) return err(req, 404, 'Pass tidak ditemukan');
    try {
      if (await this.recordStat(env, req, row, 'visit', 'visit')) {
        await env.DB.prepare('INSERT INTO visits (id, pass_id, viewed_at) VALUES (?, ?, ?)').bind(uuid(), row.id, nowIso()).run();
      }
    } catch {}
    return json(req, { ok: true });
  },

  async click(req, env, slug) {
    const row = await getPass(env, slug);
    if (!row || row.disabled) return err(req, 404, 'Pass tidak ditemukan');
    let body;
    try { body = await req.json(); } catch { return err(req, 400, 'Body JSON tidak valid'); }
    const linkUrl = typeof body.link_url === 'string' ? body.link_url.trim() : '';
    const state = publicState(row);
    const ok = state.links.some((l) => l.url === linkUrl || normUrl(l.url) === linkUrl);
    if (!ok) return err(req, 400, 'Link tidak ada di pass ini');
    // Store the normalized URL so the manage page (which normalizes the
    // same way) always finds the count, including links without a scheme.
    const storedUrl = normUrl(linkUrl);
    try {
      if (await this.recordStat(env, req, row, 'click', storedUrl)) {
        await env.DB.prepare('INSERT INTO link_clicks (id, pass_id, link_url, clicked_at) VALUES (?, ?, ?, ?)').bind(uuid(), row.id, storedUrl, nowIso()).run();
      }
    } catch {}
    return json(req, { ok: true });
  },

  async updatePass(req, env, slug) {
    const row = await getPass(env, slug);
    if (!row) return err(req, 404, 'Pass tidak ditemukan');
    if (!(await requireManage(env, req, row))) return err(req, 403, 'Link kelola tidak valid');
    let body;
    try { body = await req.json(); } catch { return err(req, 400, 'Body JSON tidak valid'); }
    let clean;
    try { clean = sanitizeState(body.state); } catch (e) { return err(req, 400, e.message); }
    let recoveryEmail = row.recovery_email;
    if (body.recovery_email !== undefined) {
      if (body.recovery_email === '' || body.recovery_email === null) recoveryEmail = null;
      else if (typeof body.recovery_email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.recovery_email)) recoveryEmail = body.recovery_email.trim().toLowerCase();
      else return err(req, 400, 'Email pemulihan tidak valid');
    }
    const now = nowIso();
    await env.DB.prepare('UPDATE passes SET state = ?, avatar = ?, recovery_email = ?, updated_at = ?, last_active_at = ? WHERE id = ?')
      .bind(JSON.stringify(clean.state), clean.state.avatar, recoveryEmail, now, now, row.id).run();
    return json(req, { ok: true, slug, dropped: clean.dropped });
  },

  async deletePass(req, env, slug) {
    const row = await getPass(env, slug);
    if (!row) return err(req, 404, 'Pass tidak ditemukan');
    if (!(await requireManage(env, req, row))) return err(req, 403, 'Link kelola tidak valid');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM visits WHERE pass_id = ?').bind(row.id),
      env.DB.prepare('DELETE FROM link_clicks WHERE pass_id = ?').bind(row.id),
      env.DB.prepare('DELETE FROM recovery_requests WHERE pass_id = ?').bind(row.id),
      env.DB.prepare('DELETE FROM passes WHERE id = ?').bind(row.id),
    ]);
    return json(req, { ok: true });
  },

  async passStats(req, env, slug) {
    const row = await getPass(env, slug);
    if (!row) return err(req, 404, 'Pass tidak ditemukan');
    if (!(await requireManage(env, req, row))) return err(req, 403, 'Link kelola tidak valid');
    const visits = await env.DB.prepare('SELECT COUNT(*) AS c FROM visits WHERE pass_id = ?').bind(row.id).first();
    const clicks = await env.DB.prepare('SELECT link_url, COUNT(*) AS c FROM link_clicks WHERE pass_id = ? GROUP BY link_url').bind(row.id).all();
    return json(req, { slug, visits: visits ? visits.c : 0, clicks: (clicks.results || []).map((r) => ({ link_url: r.link_url, count: r.c })) });
  },

  async recover(req, env, slug) {
    const row = await getPass(env, slug);
    if (!row || row.disabled) return json(req, { ok: true });
    let body;
    try { body = await req.json(); } catch { return json(req, { ok: true }); }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email && row.recovery_email && email === row.recovery_email) {
      await env.DB.prepare('INSERT INTO recovery_requests (id, pass_id, email, status, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, NULL)')
        .bind(uuid(), row.id, email, 'pending', nowIso()).run();
    }
    return json(req, { ok: true });
  },

  async admin(req, env, path) {
    if (!(await requireAdmin(env, req))) return err(req, 403, 'Kunci admin tidak valid');
    const method = req.method;

    if (path === '/admin/stats' && method === 'GET') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const q = async (sql, ...args) => {
        const r = await env.DB.prepare(sql).bind(...args).first();
        return r ? r.c : 0;
      };
      return json(req, {
        totalPasses: await q('SELECT COUNT(*) AS c FROM passes'),
        activePasses: await q('SELECT COUNT(*) AS c FROM passes WHERE disabled = 0'),
        newPasses7d: await q('SELECT COUNT(*) AS c FROM passes WHERE created_at > ?', weekAgo),
        newPasses1h: await q('SELECT COUNT(*) AS c FROM passes WHERE created_at > ?', hourAgo),
        totalVisits: await q('SELECT COUNT(*) AS c FROM visits'),
        totalClicks: await q('SELECT COUNT(*) AS c FROM link_clicks'),
        pendingRecovery: await q("SELECT COUNT(*) AS c FROM recovery_requests WHERE status = 'pending'"),
      });
    }

    if (path === '/admin/passes' && method === 'GET') {
      const url = new URL(req.url);
      const term = (url.searchParams.get('q') || '').trim();
      let rows;
      if (term) {
        const like = '%' + term + '%';
        rows = await env.DB.prepare(
          'SELECT p.*, (SELECT COUNT(*) FROM visits WHERE pass_id = p.id) AS visits, (SELECT COUNT(*) FROM link_clicks WHERE pass_id = p.id) AS clicks FROM passes p WHERE p.slug LIKE ? OR p.state LIKE ? ORDER BY p.created_at DESC LIMIT 50'
        ).bind(like, like).all();
      } else {
        rows = await env.DB.prepare(
          'SELECT p.*, (SELECT COUNT(*) FROM visits WHERE pass_id = p.id) AS visits, (SELECT COUNT(*) FROM link_clicks WHERE pass_id = p.id) AS clicks FROM passes p ORDER BY p.created_at DESC LIMIT 50'
        ).all();
      }
      return json(req, {
        passes: (rows.results || []).map((r) => {
          let name = '', username = '';
          try { const s = JSON.parse(r.state); name = s.name || ''; username = s.username || ''; } catch {}
          return { slug: r.slug, name, username, disabled: !!r.disabled, visits: r.visits, clicks: r.clicks, created_at: r.created_at, updated_at: r.updated_at };
        }),
      });
    }

    if (path === '/admin/recovery-requests' && method === 'GET') {
      const rows = await env.DB.prepare(
        'SELECT r.*, p.slug AS slug FROM recovery_requests r JOIN passes p ON p.id = r.pass_id ORDER BY r.created_at DESC LIMIT 50'
      ).all();
      return json(req, {
        requests: (rows.results || []).map((r) => ({ id: r.id, slug: r.slug, email: r.email, status: r.status, created_at: r.created_at, resolved_at: r.resolved_at })),
      });
    }

    const adminPassMatch = path.match(/^\/admin\/passes\/([a-z0-9-]+)\/(disable|enable|reset-manage)$/);
    if (adminPassMatch && method === 'POST') {
      const row = await getPass(env, adminPassMatch[1]);
      if (!row) return err(req, 404, 'Pass tidak ditemukan');
      const action = adminPassMatch[2];
      if (action === 'disable') {
        await env.DB.prepare('UPDATE passes SET disabled = 1, updated_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
        return json(req, { ok: true });
      }
      if (action === 'enable') {
        await env.DB.prepare('UPDATE passes SET disabled = 0, updated_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
        return json(req, { ok: true });
      }
      const token = randomToken();
      await env.DB.prepare('UPDATE passes SET manage_token_hash = ?, updated_at = ? WHERE id = ?').bind(await sha256Hex(token), nowIso(), row.id).run();
      return json(req, { ok: true, manageUrl: SITE_URL + '/manage/' + token, manageToken: token });
    }

    const adminDeleteMatch = path.match(/^\/admin\/passes\/([a-z0-9-]+)$/);
    if (adminDeleteMatch && method === 'DELETE') {
      const row = await getPass(env, adminDeleteMatch[1]);
      if (!row) return err(req, 404, 'Pass tidak ditemukan');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM visits WHERE pass_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM link_clicks WHERE pass_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM recovery_requests WHERE pass_id = ?').bind(row.id),
        env.DB.prepare('DELETE FROM passes WHERE id = ?').bind(row.id),
      ]);
      return json(req, { ok: true });
    }

    const recoveryMatch = path.match(/^\/admin\/recovery-requests\/([a-z0-9-]+)\/(approve|reject)$/);
    if (recoveryMatch && method === 'POST') {
      const requestRow = await env.DB.prepare('SELECT * FROM recovery_requests WHERE id = ?').bind(recoveryMatch[1]).first();
      if (!requestRow || requestRow.status !== 'pending') return err(req, 404, 'Permintaan tidak ditemukan');
      if (recoveryMatch[2] === 'reject') {
        await env.DB.prepare("UPDATE recovery_requests SET status = 'rejected', resolved_at = ? WHERE id = ?").bind(nowIso(), requestRow.id).run();
        return json(req, { ok: true });
      }
      const token = randomToken();
      await env.DB.prepare('UPDATE passes SET manage_token_hash = ?, updated_at = ? WHERE id = ?').bind(await sha256Hex(token), nowIso(), requestRow.pass_id).run();
      await env.DB.prepare("UPDATE recovery_requests SET status = 'approved', resolved_at = ? WHERE id = ?").bind(nowIso(), requestRow.id).run();
      return json(req, { ok: true, manageUrl: SITE_URL + '/manage/' + token, manageToken: token });
    }

    return err(req, 404, 'Rute admin tidak ditemukan');
  },
};
