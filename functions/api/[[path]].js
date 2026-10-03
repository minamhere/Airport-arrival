// Sync API for the flight planner (Cloudflare Pages Function, D1 storage).
//
//   GET    /api/session              -> { configured, authenticated }
//   POST   /api/login   {token}      -> sets session cookie
//   POST   /api/logout               -> clears session cookie
//   GET    /api/items                -> { items: [{ kind, id, data, updatedAt }] }
//   PUT    /api/items/:kind/:id      -> upsert (body = item JSON)
//   DELETE /api/items/:kind/:id      -> delete
//
// Bindings: DB (D1 database), SYNC_TOKEN (secret passphrase).

const COOKIE = 'fp_session';
const KINDS = new Set(['trip', 'place']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY = 64 * 1024;
const ONE_YEAR = 60 * 60 * 24 * 365;

let schemaReady = false;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

async function hmacHex(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// Cookie holds an HMAC derived from the token, never the token itself.
const sessionValue = env => hmacHex(env.SYNC_TOKEN, 'flight-planner-session-v1');

async function isAuthed(request, env) {
  const cookie = readCookie(request, COOKIE);
  return !!cookie && safeEqual(cookie, await sessionValue(env));
}

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS items (
       kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
       updated_at INTEGER NOT NULL, PRIMARY KEY (kind, id))`
  ).run();
  schemaReady = true;
}

function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function onRequest({ request, env, params }) {
  const path = params.path || [];
  const route = path.join('/');
  const method = request.method;

  if (!env.SYNC_TOKEN || !env.DB) {
    return json({ error: 'Server not configured: set the DB binding and SYNC_TOKEN secret.', configured: false }, 503);
  }

  // Writes must be JSON; cross-origin JSON requests require a CORS preflight this API never grants.
  if (method !== 'GET' && method !== 'DELETE' && !(request.headers.get('content-type') || '').includes('application/json')) {
    return json({ error: 'Expected application/json' }, 415);
  }

  if (route === 'session' && method === 'GET') {
    return json({ configured: true, authenticated: await isAuthed(request, env) });
  }

  if (route === 'login' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const given = typeof body.token === 'string' ? body.token : '';
    const ok = safeEqual(await hmacHex(env.SYNC_TOKEN, given), await hmacHex(env.SYNC_TOKEN, env.SYNC_TOKEN));
    if (!ok) {
      await new Promise(r => setTimeout(r, 750)); // slow down guessing
      return json({ error: 'Wrong passphrase' }, 401);
    }
    return json({ ok: true }, 200, { 'set-cookie': cookieHeader(await sessionValue(env), ONE_YEAR) });
  }

  if (route === 'logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': cookieHeader('', 0) });
  }

  if (!(await isAuthed(request, env))) return json({ error: 'Not signed in' }, 401);
  await ensureSchema(env.DB);

  if (route === 'items' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT kind, id, data, updated_at FROM items').all();
    const items = results.map(r => ({ kind: r.kind, id: r.id, data: JSON.parse(r.data), updatedAt: r.updated_at }));
    return json({ items });
  }

  if (path[0] === 'items' && path.length === 3) {
    const [, kind, id] = path;
    if (!KINDS.has(kind) || !ID_RE.test(id)) return json({ error: 'Bad item reference' }, 400);

    if (method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ error: 'Item too large' }, 413);
      let data;
      try { data = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'Item must be an object' }, 400);
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO items (kind, id, data, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
      ).bind(kind, id, JSON.stringify(data), now).run();
      return json({ ok: true, updatedAt: now });
    }

    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM items WHERE kind = ?1 AND id = ?2').bind(kind, id).run();
      return json({ ok: true });
    }
  }

  return json({ error: 'Not found' }, 404);
}
