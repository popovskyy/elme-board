// Seed the store from the exported board (../board.json, written from the claude.ai artifact).
// File store: copies it to BOARD_FILE. Postgres store: TODO(Cursor) insert into the tables in db/schema.sql.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const src = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || '../board.json');
if (!existsSync(src)) { console.error(`No export at ${src}`); process.exit(1); }
if (process.env.DATABASE_URL) { console.error('Postgres seeding is not implemented yet (see README, Next steps).'); process.exit(1); }
const dest = path.resolve(process.env.BOARD_FILE || './data/board.json');
if (existsSync(dest) && !process.argv.includes('--force')) { console.error(`${dest} exists; pass --force to overwrite.`); process.exit(1); }
mkdirSync(path.dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`Seeded ${dest} from ${src}`);
