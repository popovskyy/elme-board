// Daily update: what happened on the board on one calendar day, as a plain-text message in English and
// Ukrainian that Roman copies into a chat. Built from the ticket logs, no AI: the same day always gives the same text.

export const DIGEST_TZ = 'Europe/Kyiv';

const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');

/** Offset of `tz` from UTC at the moment `ms`, in ms (Kyiv in winter: +2 h). */
function tzOffset(tz, ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Calendar date (YYYY-MM-DD) in `tz` at the moment `ms`. */
export function dateIn(tz, ms) {
  const d = new Date(ms + tzOffset(tz, ms));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function shiftDate(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10);
}

/** [from, to) in UTC ms of the calendar day `date` in `tz` (23 or 25 hours on a clock-change day). */
export function dayRange(date, tz = DIGEST_TZ) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be YYYY-MM-DD');
  const start = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    const wall = Date.UTC(y, m - 1, d);
    let ms = wall - tzOffset(tz, wall);
    ms = wall - tzOffset(tz, ms); // the offset at the guessed moment, in case the first guess crossed a clock change
    return ms;
  };
  return { from: start(date), to: start(shiftDate(date, 1)) };
}

// Blocks that are about the PC or the tool, not about the work: they do not belong in an update for people.
const TECHNICAL = ['limit', 'no_report', 'dirty', 'stopped', 'timeout', 'error', 'docker'];
const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** What the builder said it did: the first real line of its report after the "Done, handed to QA" header. */
function builderLine(text) {
  const rest = String(text || '').split('\n').slice(1)
    .map((l) => l.replace(/^[#>\-*\s]+/, '').replace(/[*`]/g, '').trim())
    .filter((l) => l && !/^(RESULT|COMMITS|SUMMARY|QUESTION)\s*:/i.test(l) && !/^(built|summary|what was built)\s*:?$/i.test(l));
  return clip(rest[0] || '', 220);
}

/**
 * Where each ticket stood at the end of the day, from that day's log entries (oldest first).
 * Returns { shipped, review, qa, progress, blocked: Item[], seo: id[], ideas: {id, verdict}[], runs, bugNotes }.
 */
export function digestFacts(tickets, logs) {
  const out = { shipped: [], review: [], qa: [], progress: [], blocked: [], seo: [], ideas: [], runs: 0, bugNotes: 0 };
  for (const [id, entries] of Object.entries(logs || {})) {
    const t = tickets?.[id];
    if (!t || !entries?.length) continue;
    let state = null, detail = '', question = '', rounds = 0, lastAt = 0;
    for (const e of entries) {
      const text = String(e.text || '');
      lastAt = Math.max(lastAt, e.at || 0);
      if (/^PC started /.test(text)) {
        out.runs++;
        if (/as the (fe|be)-engineer/.test(text) && state !== 'shipped') state = 'progress';
        else if (/as the qa-engineer/.test(text) && state !== 'shipped') state = 'qa';
      } else if (/^Done, handed to QA/.test(text)) { state = 'qa'; rounds++; detail = builderLine(text) || detail; }
      else if (e.kind === 'qa_report') state = /^#+\s*Bugs\s*\n+\s*(None|No bugs)/i.test(text.trim()) ? 'review' : 'progress';
      else if (e.who === 'roman' && /^Accepted after review/.test(text)) state = 'shipped';
      else if (e.who === 'watcher' && /^Merged `/.test(text)) state = 'shipped';
      else if (e.kind === 'question' && !TECHNICAL.includes(e.code)) { state = 'blocked'; question = clip(firstLine(text), 200); }
      else if (e.kind === 'answer' && state === 'blocked') state = 'progress';
      else if (e.kind === 'seo') out.seo.push(id);
      else if (e.kind === 'ideas') out.ideas.push({ id, verdict: (/^Verdict:\s*(\w+)/.exec(text) || [])[1] || '' });
      else if (e.kind === 'bug' && e.who === 'roman') out.bugNotes++;
    }
    if (!state) continue;
    const checks = (t.qaChecks || []).filter(Boolean);
    out[state].push({
      id, title: t.title, detail, question, rounds, lastAt,
      qaPassed: checks.filter((c) => c.state === 'passed').length, qaTotal: (t.qa || []).length,
    });
  }
  for (const k of ['shipped', 'review', 'qa', 'progress', 'blocked']) out[k].sort((a, b) => a.lastAt - b.lastAt);
  out.seo = [...new Set(out.seo)];
  return out;
}

const plural = (n, one, few, many) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

const L = {
  en: {
    locale: 'en-GB',
    title: (weekday, day) => `Elme Living, update for ${weekday}, ${day}`,
    shipped: 'Done and merged into main',
    review: 'Built, passed QA, waiting for review',
    qa: 'Built, in QA',
    progress: 'In progress',
    blocked: 'Blocked, needs an answer',
    also: 'Also',
    seo: (ids) => `SEO plan: ${ids}`,
    ideas: (ids) => `design review: ${ids}`,
    rounds: (n) => `${n} rounds of fixes`,
    total: 'Total',
    nShipped: (n) => `${n} ${n === 1 ? 'ticket' : 'tickets'} done`,
    nReview: (n) => `${n} waiting for review`,
    nQaChecks: (a, b) => `${a} of ${b} QA checks passed`,
    empty: 'No ticket moved on the board that day.',
  },
  uk: {
    locale: 'uk-UA',
    title: (weekday, day) => `Elme Living, апдейт за ${day} (${weekday})`,
    shipped: 'Готово і змержено в main',
    review: 'Зроблено, пройшло QA, чекає на рев\'ю',
    qa: 'Зроблено, зараз у QA',
    progress: 'В роботі',
    blocked: 'Заблоковано, потрібна відповідь',
    also: 'Також',
    seo: (ids) => `SEO-план: ${ids}`,
    ideas: (ids) => `дизайн-рев'ю: ${ids}`,
    rounds: (n) => `${n} ${plural(n, 'коло', 'кола', 'кіл')} правок`,
    total: 'Разом',
    nShipped: (n) => `${n} ${plural(n, 'тікет', 'тікети', 'тікетів')} закрито`,
    nReview: (n) => `${n} ${plural(n, 'чекає', 'чекають', 'чекають')} на рев'ю`,
    nQaChecks: (a, b) => `${a} з ${b} QA-перевірок пройдено`,
    empty: 'За цей день тікети на борді не рухались.',
  },
};

/** The message. `details` adds the builder's one-line summary (always English, as the agents write it) under a ticket. */
export function digestText(facts, date, lang = 'en', details = true) {
  const s = L[lang] || L.en;
  const [y, m, d] = date.split('-').map(Number);
  const fmt = (opts) => new Intl.DateTimeFormat(s.locale, { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
  const lines = [s.title(fmt({ weekday: 'long' }), fmt({ day: 'numeric', month: 'long' }))];
  const section = (key) => {
    const items = facts[key];
    if (!items.length) return;
    lines.push('', `${s[key]} (${items.length}):`);
    for (const it of items) {
      const extra = it.rounds > 1 && key !== 'blocked' ? ` (${s.rounds(it.rounds)})` : '';
      lines.push(`• ${it.id} ${it.title}${extra}`);
      if (key === 'blocked' && it.question) lines.push(`   ${it.question}`);
      else if (details && it.detail && key !== 'progress') lines.push(`   ${it.detail}`);
    }
  };
  for (const key of ['shipped', 'review', 'qa', 'progress', 'blocked']) section(key);
  const moved = ['shipped', 'review', 'qa', 'progress', 'blocked'].some((k) => facts[k].length);
  const also = [
    facts.seo.length ? s.seo(facts.seo.join(', ')) : '',
    facts.ideas.length ? s.ideas(facts.ideas.map((i) => i.id).join(', ')) : '',
  ].filter(Boolean);
  if (also.length) lines.push('', `${s.also}: ${also.join('; ')}.`);
  if (!moved && !also.length) lines.push('', s.empty);
  if (facts.shipped.length || facts.review.length) {
    const passed = facts.shipped.reduce((a, it) => a + it.qaPassed, 0);
    const total = facts.shipped.reduce((a, it) => a + it.qaTotal, 0);
    const parts = [
      facts.shipped.length ? s.nShipped(facts.shipped.length) : '',
      facts.review.length ? s.nReview(facts.review.length) : '',
      total ? s.nQaChecks(passed, total) : '',
    ].filter(Boolean);
    lines.push('', `${s.total}: ${parts.join(', ')}.`);
  }
  return lines.join('\n');
}

/** Everything the board page needs for one day. */
export function buildDigest(tickets, logs, date, today) {
  const facts = digestFacts(tickets, logs);
  const text = {};
  for (const lang of ['en', 'uk']) text[lang] = { full: digestText(facts, date, lang, true), short: digestText(facts, date, lang, false) };
  return {
    date, prev: shiftDate(date, -1), next: date < today ? shiftDate(date, 1) : null, today,
    counts: { shipped: facts.shipped.length, review: facts.review.length, qa: facts.qa.length, progress: facts.progress.length, blocked: facts.blocked.length, runs: facts.runs },
    text,
  };
}
