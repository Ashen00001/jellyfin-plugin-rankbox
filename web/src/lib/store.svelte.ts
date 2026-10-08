import type { Backend, Finished, Friend, Settings } from './api';
import { SignedOut } from './api';
import { Board, type BoardView } from './engine/board';
import type { Item, ListKey, Question, Result, Tier } from './engine/types';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'signed-out';

/**
 * App state: one Board per list, saved to the server shortly after every change.
 * Views read `rb.view` / `rb.q`; every mutation goes through a method here so saving and
 * re-rendering can't be forgotten.
 */
export class RankBox {
  backend: Backend;
  list = $state<ListKey>('series');
  loading = $state(true);
  error = $state<string | null>(null);
  me = $state<{ id: string; name: string }>({ id: '', name: '' });
  items = $state.raw<Map<string, Item>>(new Map());
  view = $state.raw<BoardView | null>(null);
  q = $state.raw<Question | null>(null);
  refining = $state(false);
  canUndo = $state(false);
  save = $state<SaveStatus>('idle');
  inbox = $state.raw<Finished[]>([]);
  settings = $state<Settings>({ shareWithFriends: false });
  friends = $state.raw<Friend[]>([]);

  private board: Board | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;

  constructor(backend: Backend) {
    this.backend = backend;
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', (e) => { if (this.pending) { void this.flush(); e.preventDefault(); } });
    }
  }

  get b(): Board { return this.board!; }

  async start(list: ListKey = 'series') {
    try {
      this.me = await this.backend.me();
      this.settings = await this.backend.settings().catch(() => ({ shareWithFriends: false }));
    } catch (e) {
      return this.fail(e);
    }
    await this.load(list);
  }

  async load(list: ListKey) {
    await this.flush();
    this.list = list;
    this.loading = true;
    this.error = null;
    try {
      const [items, state, inbox] = await Promise.all([
        this.backend.candidates(list),
        this.backend.state(list),
        this.backend.inbox().catch(() => [] as Finished[]),
      ]);
      this.items = new Map(items.map((i) => [i.id, i]));
      this.board = new Board(items, state);
      this.board.refining = this.refining;
      this.inbox = inbox;
      this.sync(false);
      this.loading = false;
      this.backend.friends(list).then((f) => (this.friends = f)).catch(() => (this.friends = []));
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown) {
    this.loading = false;
    if (e instanceof SignedOut) { this.save = 'signed-out'; this.error = 'signed-out'; return; }
    this.error = e instanceof Error ? e.message : String(e);
  }

  /** Push the board's state into the reactive fields and (optionally) schedule a save. */
  private sync(changed = true) {
    const b = this.board!;
    this.view = b.view;
    this.q = b.next();
    this.canUndo = b.canUndo();
    if (changed) this.schedule();
  }

  private schedule() {
    this.pending = true;
    this.save = 'saving';
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 600);
  }

  async flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pending || !this.board) return;
    this.pending = false;
    try {
      await this.backend.save(this.list, this.board.persisted());
      this.save = this.pending ? 'saving' : 'saved';
    } catch (e) {
      this.pending = true;
      this.save = e instanceof SignedOut ? 'signed-out' : 'error';
      if (!(e instanceof SignedOut)) this.timer = setTimeout(() => void this.flush(), 4000);
    }
  }

  /* ---------- actions ---------- */

  answer(r: Result) { if (this.q) { this.b.answer(this.q, r); this.sync(); } }
  skip() { if (this.q) { this.b.skip(this.q); this.sync(); } }
  undo() { this.b.undo(); this.sync(); }
  move(id: string, to: number) { this.b.move(id, to); this.sync(); }
  setTier(id: string, t: Tier | null) { this.b.setTier(id, t); this.sync(); }
  exclude(id: string) { this.b.exclude(id); this.sync(); }
  include(id: string) { this.b.include(id); this.sync(); }
  rerank(id: string) { this.b.rerank(id); this.sync(); }
  reset() { this.b.reset(); this.refining = false; this.sync(); }
  setWatchedOnly(on: boolean) { this.b.setWatchedOnly(on); this.sync(); }
  setRefining(on: boolean) { this.refining = on; this.b.refining = on; this.sync(false); }

  async rankNow(f: { id: string; list?: ListKey }) {
    if (f.list && f.list !== this.list && this.list !== 'all') await this.load(f.list);
    if (!this.items.has(f.id)) return;
    this.b.rankNow(f.id);
    this.dismiss(f.id);
    this.sync();
  }

  dismiss(id: string) {
    this.inbox = this.inbox.filter((f) => f.id !== id);
    this.backend.dismiss(id).catch(() => {});
  }

  async favorites(n = 10) {
    await this.flush();
    return this.backend.favorites(this.view!.ranked.slice(0, n).map((r) => r.id));
  }

  async setShare(on: boolean) {
    this.settings = { shareWithFriends: on };
    await this.backend.saveSettings(this.settings);
    this.friends = on ? await this.backend.friends(this.list).catch(() => []) : [];
  }

  item(id: string): Item | undefined { return this.items.get(id); }
}
