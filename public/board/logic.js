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

export function pickable(tickets) {
    return tickets
        .filter((t) => t.waiting && AGENTS.includes(t.holder))
        .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))[0] || null;
}
