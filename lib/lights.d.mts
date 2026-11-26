import type { Lights } from './store/types';
export function emptyLights(): Lights;
export function lightsTodo(l: Lights | null | undefined): boolean | null;
export function lightsKeyMayCall(pathname: string, method: string): boolean;
export function wishPatch(body: unknown, now: number): Partial<Lights>;
export function reportPatch(body: unknown, now: number): Partial<Lights>;
