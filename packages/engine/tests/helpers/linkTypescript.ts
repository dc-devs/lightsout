import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Make the engine repo's own typescript resolvable from a temp consumer repo (resolveConsumerTypescript walks its node_modules). */
export const linkTypescript = ({ dir }: { dir: string }) => {
	const typescriptDir = dirname(createRequire(import.meta.url).resolve('typescript/package.json'));

	mkdirSync(join(dir, 'node_modules'), { recursive: true });
	symlinkSync(realpathSync(typescriptDir), join(dir, 'node_modules', 'typescript'), 'dir');
};
