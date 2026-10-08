import type { Item, ListKey, ListState, SnapshotItem } from './engine/types';
import { emptyState } from './engine/types';

export interface Finished {
  id: string;
  name: string;
  type: 'Series' | 'Movie';
  list: ListKey;
  finishedAt: string;
  rankedAt?: number | null;
}

export interface Friend {
  userId: string;
  name: string;
  items: SnapshotItem[];
}

export interface Settings {
  shareWithFriends: boolean;
}

export interface Backend {
  demo: boolean;
  me(): Promise<{ id: string; name: string }>;
  candidates(list: ListKey): Promise<Item[]>;
  state(list: ListKey): Promise<ListState>;
  save(list: ListKey, state: ListState): Promise<void>;
  inbox(): Promise<Finished[]>;
  dismiss(id: string): Promise<void>;
  favorites(ids: string[]): Promise<number>;
  settings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  friends(list: ListKey): Promise<Friend[]>;
  poster(id: string, height?: number): string;
  backdrop(id: string): string;
  appUrl(): string;
  jellyfinUrl(): string;
}

export class SignedOut extends Error {
  constructor() { super('signed-out'); }
}

/* -------- talking to the RankBox plugin on a Jellyfin server -------- */

export interface Auth { base: string; token: string; userId?: string }

/** Jellyfin web keeps its login in localStorage; the RankBox app reuses it. */
export function authFromJellyfinStorage(base: string): Auth | null {
  try {
    const c = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
    const servers = (c.Servers || []).filter((s: any) => s.AccessToken && s.UserId);
    if (!servers.length) return null;
    const here = location.origin.toLowerCase();
    const same = servers.find((s: any) => [s.ManualAddress, s.LocalAddress, s.RemoteAddress]
      .some((a: string) => a && a.toLowerCase().replace(/\/+$/, '') === here));
    const s = same || servers.sort((a: any, b: any) => (b.DateLastAccessed || 0) - (a.DateLastAccessed || 0))[0];
    return { base, token: s.AccessToken, userId: s.UserId };
  } catch {
    return null;
  }
}

function deviceId(): string {
  try {
    let d = localStorage.getItem('rankbox.device');
    if (!d) { d = 'rankbox-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('rankbox.device', d); }
    return d;
  } catch {
    return 'rankbox-web';
  }
}

export class ApiBackend implements Backend {
  demo = false;
  constructor(private auth: Auth) {}

  private async call<T>(path: string, init: RequestInit = {}, parse: 'json' | 'none' = 'json'): Promise<T> {
    const r = await fetch(this.auth.base + path, {
      ...init,
      headers: {
        Authorization: `MediaBrowser Client="RankBox", Device="Browser", DeviceId="${deviceId()}", Version="2.0.0", Token="${this.auth.token}"`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (r.status === 401 || r.status === 403) throw new SignedOut();
    if (!r.ok) throw new Error(`${path.split('?')[0]} failed (${r.status})`);
    return (parse === 'json' && r.status !== 204 ? r.json() : undefined) as T;
  }

  me() { return this.call<{ id: string; name: string }>('/RankBox/Me'); }
  candidates(list: ListKey) { return this.call<Item[]>(`/RankBox/Candidates?list=${list}`); }
  async state(list: ListKey) {
    const s = await this.call<ListState>(`/RankBox/State?list=${list}`);
    return { ...emptyState(), ...s };
  }
  save(list: ListKey, state: ListState) {
    return this.call<void>(`/RankBox/State?list=${list}`, { method: 'POST', body: JSON.stringify(state) }, 'none');
  }
  inbox() { return this.call<Finished[]>('/RankBox/Inbox'); }
  dismiss(id: string) { return this.call<void>(`/RankBox/Inbox/Dismiss?id=${id}`, { method: 'POST' }, 'none'); }
  async favorites(ids: string[]) {
    const r = await this.call<{ marked: number }>('/RankBox/Favorites', { method: 'POST', body: JSON.stringify({ ids }) });
    return r.marked;
  }
  settings() { return this.call<Settings>('/RankBox/Settings'); }
  saveSettings(s: Settings) { return this.call<void>('/RankBox/Settings', { method: 'POST', body: JSON.stringify(s) }, 'none'); }
  friends(list: ListKey) { return this.call<Friend[]>(`/RankBox/Friends?list=${list}`); }
  poster(id: string, height = 480) { return `${this.auth.base}/Items/${id}/Images/Primary?fillHeight=${height}&quality=90`; }
  backdrop(id: string) { return `${this.auth.base}/Items/${id}/Images/Backdrop?maxWidth=1280&quality=60`; }
  appUrl() { return `${this.auth.base}/RankBox/App`; }
  jellyfinUrl() { return `${this.auth.base}/web/`; }
}
