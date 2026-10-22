// Ticket status rules shared by the board page and its tests.
// Every function takes a ticket and returns a patch to merge into it.

export const STATUSES = ['todo', 'in_progress', 'in_qa', 'review', 'done', 'blocked'];
export const HOLDERS = ['fe', 'be', 'qa', 'roman', null];
export const AGENTS = ['fe', 'be', 'qa'];

const now = () => Date.now();

export function assign(ticket, holder) {
    if (!AGENTS.includes(holder)) throw new Error(`Unknown agent: ${holder}`);
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

export function pickable(tickets) {
    return tickets
        .filter((t) => t.waiting && AGENTS.includes(t.holder))
        .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))[0] || null;
}
