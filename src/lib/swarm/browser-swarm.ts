// Stealth Browser Swarm — Anti-detect browser automation
// Manages multi-login profiles, residential proxies, human mimicry
// Attack vector: E-commerce anti-bot systems (Akamai, Cloudflare, PerimeterX)

export interface BrowserProfile {
  id: string;
  name: string;
  fingerprint: BrowserFingerprint;
  proxy: ProxyConfig;
  cookies: CookieJar;
  status: 'idle' | 'warming' | 'active' | 'banned' | 'cooldown';
  createdAt: Date;
  lastActiveAt: Date | null;
  totalSessions: number;
  trustScore: number; // 0-100 platform trust
  warmingPhase: WarmingPhase;
}

export interface BrowserFingerprint {
  canvas: string;           // Canvas fingerprint hash
  webgl: string;            // WebGL renderer hash
  audioContext: string;     // AudioContext hash
  userAgent: string;
  screen: { w: number; h: number; dpr: number };
  timezone: string;
  language: string;
  platform: string;
  webRTC: { ip: string; type: 'public' | 'reflected' | 'hidden' };
}

export interface ProxyConfig {
  host: string;
  port: number;
  protocol: 'http' | 'socks5';
  username?: string;
  password?: string;
  sticky: boolean;
  geo: string;              // country/region
  lastRotation: Date;
}

export interface CookieJar {
  domain: string;
  cookies: Array<{
    name: string;
    value: string;
    expires: Date;
    httpOnly: boolean;
    secure: boolean;
  }>;
}

export type WarmingPhase = 'cold' | 'browse' | 'search' | 'cart' | 'ready';

export interface NavigationAction {
  type: 'visit' | 'search' | 'scroll' | 'hover' | 'click' | 'add_to_cart' | 'checkout';
  url?: string;
  query?: string;
  element?: string;
  delay: number; // ms delay for human mimicry
}

export interface SessionConfig {
  targetUrl: string;
  actions: NavigationAction[];
  profileId: string;
  maxDurationMs: number;
}

// Human mimicry timing ranges (milliseconds)
const MIMICRY_TIMING = {
  typeDelay: { min: 30, max: 180 },
  scrollDelay: { min: 100, max: 400 },
  hoverDelay: { min: 200, max: 800 },
  clickDelay: { min: 50, max: 250 },
  pageLoadWait: { min: 1500, max: 4000 },
  sessionJitter: { min: -300, max: 300 },
};

// Warming phases — build trust over 48-72 hours
const WARMING_SCHEDULE: Record<WarmingPhase, { durationHours: number; maxActions: number; allowedTypes: NavigationAction['type'][] }> = {
  cold: { durationHours: 0, maxActions: 0, allowedTypes: [] },
  browse: { durationHours: 24, maxActions: 10, allowedTypes: ['visit', 'scroll'] },
  search: { durationHours: 48, maxActions: 20, allowedTypes: ['visit', 'search', 'scroll', 'hover'] },
  cart: { durationHours: 72, maxActions: 30, allowedTypes: ['visit', 'search', 'scroll', 'hover', 'click', 'add_to_cart'] },
  ready: { durationHours: 72, maxActions: 999, allowedTypes: ['visit', 'search', 'scroll', 'hover', 'click', 'add_to_cart', 'checkout'] },
};

const PROFILE_STORE: BrowserProfile[] = [];

function generateFingerprint(seed: string): BrowserFingerprint {
  const hash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(16).padStart(8, '0');
  };

  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
  ];

  const resolutions = [
    { w: 1920, h: 1080, dpr: 1 },
    { w: 2560, h: 1440, dpr: 2 },
    { w: 1366, h: 768, dpr: 1 },
  ];

  return {
    canvas: hash(seed + 'canvas'),
    webgl: hash(seed + 'webgl'),
    audioContext: hash(seed + 'audio'),
    userAgent: agents[Math.abs(hash(seed + 'ua')) % agents.length],
    screen: resolutions[Math.abs(hash(seed + 'res')) % resolutions.length],
    timezone: ['America/New_York', 'America/Chicago', 'Europe/London', 'Europe/Berlin'][Math.abs(hash(seed + 'tz')) % 4],
    language: 'en-US',
    platform: 'Win32',
    webRTC: {
      ip: `${Math.abs(hash(seed + 'ip')) % 200 + 10}.${Math.abs(hash(seed + 'ip2')) % 256}.${Math.abs(hash(seed + 'ip3')) % 256}.${Math.abs(hash(seed + 'ip4')) % 256}`,
      type: 'public',
    },
  };
}

function generateRandomDelay(range: { min: number; max: number }): number {
  return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
}

export function createProfile(name: string, proxyHost: string, proxyPort: number): BrowserProfile {
  const seed = `${name}:${Date.now()}`;
  const profile: BrowserProfile = {
    id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    fingerprint: generateFingerprint(seed),
    proxy: {
      host: proxyHost,
      port: proxyPort,
      protocol: 'socks5',
      sticky: true,
      geo: 'US',
      lastRotation: new Date(),
    },
    cookies: { domain: '', cookies: [] },
    status: 'idle',
    createdAt: new Date(),
    lastActiveAt: null,
    totalSessions: 0,
    trustScore: 0,
    warmingPhase: 'cold',
  };
  PROFILE_STORE.push(profile);
  return profile;
}

export function generateSessionPlan(profile: BrowserProfile, targetUrl: string): SessionConfig {
  const phase = WARMING_SCHEDULE[profile.warmingPhase];
  const actions: NavigationAction[] = [];

  if (profile.warmingPhase === 'cold') {
    return { targetUrl, actions: [], profileId: profile.id, maxDurationMs: 0 };
  }

  // Generate human-like navigation sequence
  actions.push({
    type: 'visit',
    url: targetUrl,
    delay: generateRandomDelay(MIMICRY_TIMING.pageLoadWait),
  });

  const numScrolls = 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < numScrolls; i++) {
    actions.push({
      type: 'scroll',
      delay: generateRandomDelay(MIMICRY_TIMING.scrollDelay),
    });
  }

  if (phase.allowedTypes.includes('search')) {
    actions.push({
      type: 'search',
      query: 'products',
      delay: generateRandomDelay(MIMICRY_TIMING.typeDelay),
    });
  }

  if (phase.allowedTypes.includes('hover')) {
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      actions.push({
        type: 'hover',
        element: `[data-product-${i}]`,
        delay: generateRandomDelay(MIMICRY_TIMING.hoverDelay),
      });
    }
  }

  if (phase.allowedTypes.includes('add_to_cart')) {
    actions.push({
      type: 'add_to_cart',
      delay: generateRandomDelay(MIMICRY_TIMING.clickDelay),
    });
  }

  return {
    targetUrl,
    actions,
    profileId: profile.id,
    maxDurationMs: phase.durationHours * 3600000,
  };
}

export function advanceWarmingPhase(profileId: string): BrowserProfile | null {
  const profile = PROFILE_STORE.find(p => p.id === profileId);
  if (!profile) return null;

  const order: WarmingPhase[] = ['cold', 'browse', 'search', 'cart', 'ready'];
  const currentIdx = order.indexOf(profile.warmingPhase);
  if (currentIdx < order.length - 1) {
    profile.warmingPhase = order[currentIdx + 1];
  }
  return profile;
}

export function getProfiles(): BrowserProfile[] {
  return PROFILE_STORE.map(p => ({ ...p }));
}

export function getProfile(id: string): BrowserProfile | undefined {
  return PROFILE_STORE.find(p => p.id === id);
}
