// Pure helpers of the PC runner, kept apart from runner.mjs so they can be tested.

// Claude: "You've hit your session limit · resets 2:30pm", "You've hit your weekly limit · resets 9pm".
// Cursor: "Weekly usage limit reached. It resets in 3 days."
const LIMIT_RE = /usage limit|rate limit|quota|out of credits|upgrade to|limit reached|hit your (\w+ )?limit|limit will reset|limit\s+·\s+resets/i;

/** True when the tail of an agent's output says the tool ran out of usage. */
export function isLimit(text) {
  return LIMIT_RE.test(String(text || ''));
}

const RECENT = 12;
const ROMAN_KEPT = 10;
const MAX_ENTRY_CHARS = 20_000;
// Written on every start; they say nothing the prompt header does not already say.
const isNoise = (e) => /^(Picked up by |PC started )/.test(e.text || '');
const isRoman = (e) => e.who === 'roman' && ['bug', 'note', 'answer'].includes(e.kind);

/**
 * Log entries an agent gets in its prompt, oldest first: the last RECENT entries that carry content,
 * plus the entries a later run must not lose however long the log grows: the latest SEO plan,
 * marketing review, QA report and builder summary, and Roman's last bug notes and answers.
 */
export function promptLog(entries) {
  const useful = (entries || []).filter((e) => !isNoise(e));
  const keep = new Set(useful.slice(-RECENT));
  const last = (pred) => { for (let i = useful.length - 1; i >= 0; i--) if (pred(useful[i])) return useful[i]; return null; };
  for (const e of [
    last((x) => x.kind === 'seo'),
    last((x) => x.kind === 'ideas'),
    last((x) => x.kind === 'qa_report'),
    last((x) => /^Done, handed to QA/.test(x.text || '')),
  ]) if (e) keep.add(e);
  for (const e of useful.filter(isRoman).slice(-ROMAN_KEPT)) keep.add(e);
  return useful.filter((e) => keep.has(e));
}

/** The "Recent log" block of the prompt. */
export function formatLog(entries) {
  const lines = promptLog(entries).map((e) => {
    const text = String(e.text || '');
    const cut = text.length > MAX_ENTRY_CHARS ? `${text.slice(0, MAX_ENTRY_CHARS)}\n[cut, ${text.length - MAX_ENTRY_CHARS} more characters on the board]` : text;
    return `- [${e.kind}] ${e.who}: ${cut}`;
  });
  return lines.join('\n') || '(empty)';
}
