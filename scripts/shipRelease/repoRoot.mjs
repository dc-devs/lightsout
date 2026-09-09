import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository these release scripts prepare and check — two levels up from this folder. */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
