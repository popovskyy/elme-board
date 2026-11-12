// Ticket status rules shared by the board page and its tests.
// Every function takes a ticket and returns a patch to merge into it.

export const STATUSES = ['todo', 'in_progress', 'in_qa', 'review', 'done', 'blocked'];
export const HOLDERS = ['fe', 'be', 'qa', 'idea', 'seo', 'roman', null];
export const AGENTS = ['fe', 'be', 'qa', 'idea', 'seo'];
const BUILDERS = ['fe', 'be', 'qa'];

const now = () => Date.now();

export function assign(ticket, holder) {
    if (!BUILDERS.includes(holder)) throw new Error(`Unknown agent: ${holder}`);
    if (ticket.kind === 'UX' && holder !== 'qa') throw new Error('UX tickets only go to QA');
    if (ticket.status === 'done') throw new Error('Ticket is done');
    return {
        status: holder === 'qa' ? 'in_qa' : 'in_progress',
        holder,
        waiting: true,
        prev: null,
        priority: 0,
        updatedAt: now(),
    };
}

export function block(ticket) {
    return {
        status: 'blocked',
        holder: 'roman',
        waiting: false,
        prev: { status: ticket.status, holder: ticket.holder },
        updatedAt: now(),
    };
}

export function answer(ticket) {
    if (ticket.status !== 'blocked' || !ticket.prev) throw new Error('Ticket is not blocked');
    return {
        status: ticket.prev.status,
        holder: ticket.prev.holder,
        waiting: AGENTS.includes(ticket.prev.holder),
        prev: null,
        updatedAt: now(),
    };
}

export function handToQa() {
    return { status: 'in_qa', holder: 'qa', waiting: true, updatedAt: now() };
}

export function qaPassed() {
    return { status: 'review', holder: 'roman', waiting: false, qaVerdict: 'passed', updatedAt: now() };
}

export function qaFailed(ticket, builder) {
    if (!['fe', 'be'].includes(builder)) throw new Error(`Unknown builder: ${builder}`);
    return { status: 'in_progress', holder: builder, waiting: true, qaVerdict: 'failed', updatedAt: now() };
}

/** Roman reopens a done ticket with a note: back to a builder (or QA), last round's QA and merge state cleared. */
export function reopen(ticket, holder) {
    if (ticket.status !== 'done') throw new Error('Only a done ticket can be reopened');
    return {
        ...assign({ ...ticket, status: 'review' }, holder),
        qaVerdict: null,
        qaChecks: (ticket.qaChecks || []).map(() => null),
        mergeRequested: false,
        mergedAt: null,
        mergeError: null,
    };
}

export function done(ticket) {
    if (ticket.status !== 'review') throw new Error('Only a ticket in review can be done');
    const branch = ticket.branch && ticket.branch !== 'main' ? ticket.branch : null;
    // Runner on the PC merges `branch` into main when mergeRequested is true.
    return {
        status: 'done',
        holder: null,
        waiting: false,
        updatedAt: now(),
        mergeRequested: !!branch,
        mergeError: null,
    };
}

/** Queue a done ticket for the marketing / design agent. Status stays done. */
const IDEA_STATUSES = ['todo', 'review', 'done'];

export function requestIdeas(ticket) {
    if (!IDEA_STATUSES.includes(ticket.status)) throw new Error('Marketing review is for a ticket before work, in review, or done');
    if (ticket.waiting) throw new Error('An agent is already on this ticket');
    return {
        holder: 'idea',
        waiting: true,
        prev: { status: ticket.status, holder: ticket.holder },
        updatedAt: now(),
    };
}

/** Ideas agent finished. Restores the done ticket and stores ship | push. */
export function ideasDone(ticket, verdict) {
    if (ticket.holder !== 'idea') throw new Error('Ticket is not with the ideas agent');
    if (verdict !== 'ship' && verdict !== 'push') throw new Error('Verdict must be ship or push');
    const prev = ticket.prev || { status: 'done', holder: null };
    return {
        status: prev.status,
        holder: prev.holder,
        waiting: false,
        prev: null,
        ideaVerdict: verdict,
        updatedAt: now(),
    };
}

/** Who builds a follow-up after the marketing review. */
export function devHolder(ticket) {
    if (ticket.builder === 'be' || ticket.kind === 'BE') return 'be';
    if (ticket.kind === 'UX') return 'qa';
    return 'fe';
}

/**
 * Roman accepted the marketing review, or wrote his own note.
 * The ticket leaves Done and goes back to the developer.
 */
export function buildFromIdeas(ticket) {
    if (!['todo', 'review', 'done'].includes(ticket.status)) throw new Error('Send the marketing idea on before work starts, in review, or when done');
    if (ticket.waiting) throw new Error('An agent is already on this ticket');
    const holder = devHolder(ticket);
    return {
        status: holder === 'qa' ? 'in_qa' : 'in_progress',
        holder,
        waiting: true,
        prev: null,
        // A new round: last round's QA and merge state no longer describe the code.
        qaVerdict: null,
        qaChecks: (ticket.qaChecks || []).map(() => null),
        mergedAt: null,
        mergeError: null,
        updatedAt: now(),
    };
}

/** Ideas agent stopped without a verdict. Puts the ticket back, no fake verdict. */
export function ideasRestore(ticket) {
    if (ticket.holder !== 'idea') throw new Error('Ticket is not with the ideas agent');
    const prev = ticket.prev || { status: 'done', holder: null };
    return { status: prev.status, holder: prev.holder, waiting: false, prev: null, updatedAt: now() };
}

/**
 * SEO agent plans the markup before the builder starts (or reviews a built page).
 * `then` is where the ticket goes after the plan, e.g. assign(t, 'fe'); without it the ticket returns where it was.
 */
export function requestSeo(ticket, then = null) {
    if (ticket.waiting) throw new Error('An agent is already on this ticket');
    const next = then ? { status: then.status, holder: then.holder } : { status: ticket.status, holder: ticket.holder };
    return { status: next.status, holder: 'seo', waiting: true, prev: next, updatedAt: now() };
}

/** SEO plan written. The ticket continues to the builder queued behind it, or goes back where it was. */
export function seoDone(ticket) {
    if (ticket.holder !== 'seo') throw new Error('Ticket is not with the SEO agent');
    const prev = ticket.prev || { status: ticket.status, holder: null };
    return {
        status: prev.status,
        holder: prev.holder,
        waiting: BUILDERS.includes(prev.holder),
        prev: null,
        updatedAt: now(),
    };
}

/** Queue order, shared by the page and the PC runner: "Run next" (priority) first, then oldest. */
export function queueCompare(a, b) {
    return ((b.priority || 0) - (a.priority || 0)) || ((a.updatedAt || 0) - (b.updatedAt || 0));
}

export function queued(tickets) {
    return tickets.filter((t) => t.waiting && AGENTS.includes(t.holder) && !t.archived).sort(queueCompare);
}

export function pickable(tickets) {
    return queued(tickets)[0] || null;
}

/** Roman moves a queued ticket to the front. */
export function runNext(ticket, tickets) {
    if (!ticket.waiting) throw new Error('Ticket is not in the queue');
    const top = Math.max(0, ...tickets.filter((t) => t.waiting).map((t) => t.priority || 0));
    return { priority: top + 1 };
}

/**
 * Roman takes a ticket off the queue before the PC starts it.
 * No branch yet: back to To do. With a branch (work exists): blocked with Roman, so Rerun picks up where it was.
 */
export function cancelQueue(ticket) {
    if (!ticket.waiting) throw new Error('Ticket is not in the queue');
    if (ticket.holder === 'idea') return { ...ideasRestore(ticket), priority: 0 };
    const target = ticket.holder === 'seo' ? (ticket.prev || { status: ticket.status, holder: null }) : { status: ticket.status, holder: ticket.holder };
    if (!ticket.branch || !target.holder) return { status: 'todo', holder: null, waiting: false, prev: null, priority: 0, updatedAt: now() };
    return { status: 'blocked', holder: 'roman', waiting: false, prev: target, priority: 0, updatedAt: now() };
}

export function archive(ticket) {
    if (ticket.waiting) throw new Error('An agent is on this ticket; cancel or stop it first');
    return { archived: true, updatedAt: now() };
}

export function unarchive() {
    return { archived: false, updatedAt: now() };
}

/**
 * Agent kit: which Claude Code plugins a run of this ticket gets, and which project skills it must use.
 * Plugins are switched per run with `claude --settings`; skills are named in the prompt.
 * Defaults keep runs lean: superpowers (brainstorm, plan, subagents) and the Playwright browser
 * (whole page snapshots in the context) only when a ticket asks for them.
 */
export const KIT_PLUGINS = {
    superpowers: { id: 'superpowers@claude-plugins-official', label: 'Superpowers', hint: 'brainstorm, plan, TDD, review; costly' },
    frontendDesign: { id: 'frontend-design@claude-plugins-official', label: 'Frontend design', hint: 'design quality pass for UI work' },
    playwright: { id: 'playwright@claude-plugins-official', label: 'Playwright browser', hint: 'live browser in the context; heavy. QA uses browse.mjs without it' },
};
export const KIT_SKILLS = [
    'elme-business', 'elme-product-data', 'elme-port-from-luma', 'elme-look-options', 'elme-qa',
    'hyva-alpine-component', 'hyva-create-module', 'hyva-tailwind-include-exclude', 'hyva-compile-tailwind-css',
    'hyva-render-media-image', 'hyva-playwright-test', 'hyva-exec-shell-cmd', 'hyva-theme-list',
    'emil-design-eng', 'review-animations', 'web-interface-guidelines',
];

/** The kit a run uses: the ticket's own choices over the defaults. `skills: []` lets the agent pick. */
export function agentKit(ticket) {
    const k = ticket.kit || {};
    const ui = ticket.kind !== 'BE';
    return {
        superpowers: k.superpowers ?? false,
        frontendDesign: k.frontendDesign ?? ui,
        playwright: k.playwright ?? false,
        skills: (k.skills || []).filter((s) => KIT_SKILLS.includes(s)),
        custom: !!ticket.kit,
    };
}

/** `claude --settings` value that switches the plugins off or on for one run. */
export function kitSettings(kit) {
    const enabledPlugins = {};
    for (const [key, p] of Object.entries(KIT_PLUGINS)) enabledPlugins[p.id] = !!kit[key];
    return JSON.stringify({ enabledPlugins });
}

/** Prompt lines for the kit (both tools: Cursor has no plugins, but follows the same skill list). */
export function kitPrompt(kit) {
    const lines = [];
    if (kit.skills.length) lines.push(`Use these project skills (read each before the step it covers): ${kit.skills.join(', ')}. Do not load other skills unless the ticket clearly needs one; say in the report which one and why.`);
    if (!kit.superpowers) lines.push('Work straight from the ticket: no brainstorming or planning ceremony, no subagents.');
    if (!kit.playwright) lines.push('For screenshots and page checks use the elme-qa scripts (browse.mjs, smoke.sh), not a live browser tool.');
    return lines.length ? `\n\n# Agent kit\n${lines.map((l) => `- ${l}`).join('\n')}` : '';
}

const EDITABLE = ['title', 'scope', 'ref', 'qa', 'deps', 'wave', 'waveName', 'epic', 'kind'];

/** Roman edits a ticket. QA checks keep their state where the item text did not change. */
export function editTicket(ticket, input) {
    if (ticket.waiting) throw new Error('An agent is on this ticket; edit it after the run');
    if (!String(input.title ?? ticket.title).trim()) throw new Error('Title is required');
    if (input.kind && input.kind !== ticket.kind && ticket.status !== 'todo') throw new Error('Kind can change only before work starts');
    const patch = {};
    for (const k of EDITABLE) if (input[k] !== undefined) patch[k] = typeof input[k] === 'string' ? input[k].trim() : input[k];
    if (patch.qa) {
        const old = ticket.qa || [];
        const checks = ticket.qaChecks || [];
        patch.qa = patch.qa.map((q) => String(q).trim()).filter(Boolean);
        patch.qaChecks = patch.qa.map((q) => { const i = old.indexOf(q); return i >= 0 ? (checks[i] ?? null) : null; });
    }
    if (patch.deps) patch.deps = patch.deps.filter((d) => d && d !== ticket.id);
    return { ...patch, updatedAt: now() };
}
