import type { LogEntry, Ticket } from './store/types';
export const DIGEST_TZ: string;
export function dateIn(tz: string, ms: number): string;
export function shiftDate(date: string, days: number): string;
export function dayRange(date: string, tz?: string): { from: number; to: number };
export type Digest = {
  date: string; prev: string; next: string | null; today: string;
  counts: Record<'shipped' | 'review' | 'qa' | 'progress' | 'blocked' | 'runs', number>;
  text: Record<'en' | 'uk', { full: string; short: string }>;
};
export function buildDigest(tickets: Record<string, Ticket>, logs: Record<string, LogEntry[]>, date: string, today: string): Digest;
