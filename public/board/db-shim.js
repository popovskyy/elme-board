// Gives the board page (written for the claude.ai artifact `db` capability) the same
// `window.claude.use('db')` surface, backed by this app's API with polling.
(() => {
  const POLL_MS = 5000;
  const api = async (path, opts = {}) => {
    const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json' }, cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { code: res.status === 409 ? 'conflict' : 'unavailable' });
    return body;
  };
  const snapOf = (map) => {
    const docs = Object.values(map || {}).map((d) => ({ id: d.id, exists: true, data: () => d, metadata: {} }));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} };
  };

  // One shared poll of /api/board feeds every collection listener.
  const listeners = { tickets: new Set(), decisions: new Set() };
  let last = '', timer = null;
  async function poll() {
    if (document.hidden) return;
    try {
      const board = await api('/api/board');
      const sig = JSON.stringify([board.tickets, board.decisions]);
      if (sig !== last) {
        last = sig;
        listeners.tickets.forEach((fn) => fn(snapOf(board.tickets)));
        listeners.decisions.forEach((fn) => fn(snapOf(board.decisions)));
      }
      window.dispatchEvent(new CustomEvent('board:meta', { detail: { runnerStatus: board.runnerStatus, runs: board.runs } }));
    } catch (e) { /* keep polling; the page shows the last good state */ }
  }
  function ensurePolling() {
    if (timer) return;
    poll();
    timer = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', () => !document.hidden && poll());
  }

  function collection(name) {
    return {
      onSnapshot(next) {
        listeners[name]?.add(next);
        last = '';
        ensurePolling();
        return () => listeners[name]?.delete(next);
      },
    };
  }

  function doc(path) {
    const [col, id] = path.split('/');
    if (col === 'tickets') {
      return {
        update: async (patch) => { await api(`/api/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ patch }) }); last = ''; poll(); },
      };
    }
    if (col === 'log') {
      const get = async () => {
        const d = await api(`/api/log/${id}`);
        return { id, exists: !!d.version, data: () => d, metadata: {} };
      };
      return {
        get,
        set: async ({ entries }) => { await api(`/api/log/${id}`, { method: 'PUT', body: JSON.stringify({ entries }) }); },
        onSnapshot(next) {
          let prev = '';
          const tick = async () => { try { const s = await get(); const sig = JSON.stringify(s.data()); if (sig !== prev) { prev = sig; next(s); } } catch {} };
          tick();
          const t = setInterval(tick, POLL_MS);
          return () => clearInterval(t);
        },
      };
    }
    throw new TypeError(`Unsupported doc path: ${path}`);
  }

  const db = { collection, doc };
  const user = { can: async () => true, isOwner: () => true };
  window.claude = { use: async (name) => (name === 'db' ? db : name === 'user' ? user : null) };
})();
