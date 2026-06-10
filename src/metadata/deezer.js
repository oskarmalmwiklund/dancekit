// BPM fallback via Deezer's public API, matched by ISRC.
// api.deezer.com has no CORS headers, but supports JSONP — so requests go
// through dynamically injected <script> tags. Throttled to stay well under
// Deezer's 50 requests / 5 s limit.

const GAP_MS = 150;
let lastRequestAt = 0;
let chain = Promise.resolve();
let cbCounter = 0;

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = `__dancekitDz${cbCounter++}`;
    const script = document.createElement('script');
    const cleanup = () => {
      delete window[cbName];
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Deezer request timed out'));
    }, 10000);
    window[cbName] = (data) => {
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('Deezer request failed'));
    };
    script.src = `${url}${url.includes('?') ? '&' : '?'}output=jsonp&callback=${cbName}`;
    document.head.appendChild(script);
  });
}

export function lookupByIsrc(isrc) {
  chain = chain.then(async () => {
    const wait = lastRequestAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    try {
      const data = await jsonp(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`);
      if (!data || data.error) return null;
      return {
        bpm: data.bpm && data.bpm > 0 ? data.bpm : null,
        gain: typeof data.gain === 'number' && data.gain !== 0 ? data.gain : null,
      };
    } catch {
      return null;
    }
  });
  return chain;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Rough energy estimate when Spotify's energy feature is unavailable:
// mostly tempo, nudged by loudness (Deezer gain is replay-gain-like, in dB).
export function estimateEnergy(bpm, gain) {
  if (bpm == null) return null;
  const bpmNorm = clamp01((bpm - 70) / 110); // 70 BPM → 0, 180 BPM → 1
  if (gain == null) return bpmNorm;
  const gainNorm = clamp01((gain + 18) / 18); // −18 dB → 0, 0 dB → 1
  return 0.7 * bpmNorm + 0.3 * gainNorm;
}
