// Authorization Code + PKCE flow, entirely in the browser. No client secret.
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

const CLIENT_KEY = 'dancekit:clientId';
const TOKEN_KEY = 'dancekit:tokens';
const VERIFIER_KEY = 'dancekit:pkceVerifier';

export function getClientId() {
  return localStorage.getItem(CLIENT_KEY) || '';
}

export function setClientId(id) {
  localStorage.setItem(CLIENT_KEY, id.trim());
}

export function getRedirectUri() {
  return `${location.origin}/callback`;
}

function b64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function loadTokens() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY));
  } catch {
    return null;
  }
}

function saveTokens(data) {
  const tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || loadTokens()?.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  return tokens;
}

export function isAuthed() {
  const t = loadTokens();
  return Boolean(t?.refreshToken || (t?.accessToken && t.expiresAt > Date.now()));
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function beginLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));

  const params = new URLSearchParams({
    client_id: getClientId(),
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: b64url(digest),
  });
  location.assign(`${AUTH_URL}?${params}`);
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed (${res.status}): ${text}`);
  }
  return saveTokens(await res.json());
}

// Call when landing on /callback. Exchanges the code for tokens.
export async function completeLogin() {
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  if (error) throw new Error(`Spotify authorization failed: ${error}`);
  const code = params.get('code');
  if (!code) throw new Error('No authorization code in callback URL');

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error('Missing PKCE verifier — restart the login from the setup screen');
  sessionStorage.removeItem(VERIFIER_KEY);

  await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    client_id: getClientId(),
    code_verifier: verifier,
  });
}

export async function getAccessToken({ force = false } = {}) {
  let tokens = loadTokens();
  if (!tokens) throw new Error('Not logged in');
  if (force || tokens.expiresAt - 60_000 < Date.now()) {
    if (!tokens.refreshToken) throw new Error('Session expired — log in again');
    tokens = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: getClientId(),
    });
  }
  return tokens.accessToken;
}
