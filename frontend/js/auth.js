const TOKEN_KEY = 'reelday_token';
const USER_KEY  = 'reelday_user';

export function getToken()  { return localStorage.getItem(TOKEN_KEY); }
export function getUser()   {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}
export function saveAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
export function logout() {
  clearAuth();
  // Land on the homepage — users logging out are leaving the app, not
  // switching accounts. The homepage CTA covers re-login if they need it.
  location.href = '/';
}
export function authHeaders() {
  const token = getToken();
  return token ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
               : { 'Content-Type': 'application/json' };
}
export function requireAuth() {
  if (!getToken()) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    return false;
  }
  return true;
}

// Inject a minimal nav bar into #site-nav if it exists
export function initNav() {
  const nav = document.getElementById('site-nav');
  if (!nav) return;
  const user = getUser();
  if (user) {
    nav.innerHTML = `
      <span class="snav-name">${escHtml(user.full_name)}</span>
      <a class="snav-link" href="/my-events">My Events</a>
      <button class="snav-btn snav-logout" id="snav-logout">Logout</button>`;
    document.getElementById('snav-logout').onclick = logout;
  } else {
    nav.innerHTML = `
      <a class="snav-link" href="/login">Login</a>
      <a class="snav-btn snav-cta" href="/start">Start Free</a>`;
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
