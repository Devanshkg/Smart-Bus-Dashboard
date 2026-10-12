/* Smart Bus Dashboard — auth client + page gate.
   Talks to Neon Auth (Managed Better Auth) for sign-up / sign-in and mints a
   JWT for our own /api/* endpoints. On dashboard pages it also runs the gate:
   redirect to auth.html when there is no session, and render the account menu.

   No bundler: plain script, exposes window.BusAuth. */
(function () {
  const AUTH_BASE = window.NEON_AUTH_URL ||
    'https://ep-curly-fire-b304c0af.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth';
  const API_BASE = window.API_BASE || '';
  const AUTH_PAGE = 'auth.html';

  let tokenCache = null;

  function authUrl(path) { return AUTH_BASE + path; }

  async function readJson(res) {
    try { return await res.json(); } catch { return {}; }
  }

  function errFrom(data, fallback) {
    return (data && (data.message || data.error)) || fallback;
  }

  /* ---- Neon Auth calls -------------------------------------------------- */

  async function signUp({ email, password, name }) {
    const res = await fetch(authUrl('/sign-up/email'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name })
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(errFrom(data, 'Could not create account.'));
    tokenCache = null;
    return data;
  }

  async function signIn({ email, password }) {
    const res = await fetch(authUrl('/sign-in/email'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(errFrom(data, 'Could not sign in.'));
    tokenCache = null;
    return data;
  }

  async function signOut() {
    try {
      await fetch(authUrl('/sign-out'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
    } catch { /* ignore */ }
    tokenCache = null;
  }

  /* Fresh JWT from the session cookie. Cached until it expires. */
  async function getToken(force) {
    if (tokenCache && !force) return tokenCache;
    const res = await fetch(authUrl('/token'), {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) { tokenCache = null; return null; }
    const data = await readJson(res);
    tokenCache = data.token || null;
    return tokenCache;
  }

  /* fetch against our own /api/* with the bearer token; refresh once on 401. */
  async function apiFetch(path, opts) {
    opts = opts || {};
    const doFetch = async (token) => {
      const headers = Object.assign({}, opts.headers);
      if (token) headers.Authorization = 'Bearer ' + token;
      return fetch(API_BASE + path, Object.assign({}, opts, { headers }));
    };
    let res = await doFetch(await getToken());
    if (res.status === 401) {
      res = await doFetch(await getToken(true));
    }
    return res;
  }

  async function me() {
    const res = await apiFetch('/api/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Session check failed');
    return res.json();
  }

  async function onboard(name) {
    const res = await apiFetch('/api/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(errFrom(data, 'Could not create school.'));
    return data;
  }

  /* ---- Page gate (dashboard pages only) --------------------------------- */

  function authRedirect() {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(AUTH_PAGE + '?next=' + next);
  }

  function reveal() {
    document.documentElement.classList.remove('auth-checking');
  }

  let ready = null;

  function startGate() {
    // Safety net: never leave the page hidden if something hangs.
    setTimeout(reveal, 8000);
    ready = (async () => {
      try {
        const token = await getToken();
        if (!token) { authRedirect(); return null; }
        const info = await me();
        if (!info || !info.school) { authRedirect(); return null; }
        renderAccountMenu(info);
        reveal();
        return info;
      } catch {
        authRedirect();
        return null;
      }
    })();
  }

  function renderAccountMenu(info) {
    const el = document.getElementById('accountMenu');
    if (!el) return;
    const name = (info.school && info.school.name) || 'My school';
    const role = (info.school && info.school.role) || '';
    el.innerHTML =
      '<span class="acct-school" title="' + escapeAttr(name) + '">' + escapeHtml(name) + '</span>' +
      (role ? '<span class="acct-role">' + escapeHtml(role) + '</span>' : '') +
      '<button type="button" class="btn btn-sm acct-signout" id="acctSignOut">Sign out</button>';
    el.hidden = false;
    const btn = document.getElementById('acctSignOut');
    if (btn) btn.addEventListener('click', async () => {
      btn.disabled = true;
      await signOut();
      location.replace(AUTH_PAGE);
    });
    const menuBtn = document.getElementById('acctToggle');
    if (menuBtn) {
      menuBtn.addEventListener('click', () => { el.hidden = !el.hidden; });
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  const BusAuth = {
    signUp, signIn, signOut, getToken, apiFetch, me, onboard,
    get ready() { return ready; }
  };
  window.BusAuth = BusAuth;

  if (document.body && document.body.hasAttribute('data-require-auth')) {
    startGate();
  } else {
    // Non-gated pages (e.g. auth.html) still get the API; ready resolves to null.
    ready = Promise.resolve(null);
  }
})();
