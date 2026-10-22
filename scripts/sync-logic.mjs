// lib/logic.mjs is the one source of the status rules; the static board page loads a copy.
import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../lib/logic.mjs', import.meta.url), new URL('../public/board/logic.js', import.meta.url));
