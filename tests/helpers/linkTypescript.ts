import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Make the engine repo's own typescript resolvable from a temp consumer repo
 * (resolveConsumerTypescript walks its node_modules). `require.resolve` rather
 * than `createRequire(import.meta.url)`: ts-jest transpiles this to CommonJS,
 * where `require` is already the local resolver createRequire was manufacturing,
 * and `import.meta` does not exist.
 */
export const linkTypescript = ({ dir }: { dir: string }): void => {
	const typescriptDir = dirname(require.resolve('typescript/package.json'));

	mkdirSync(join(dir, 'node_modules'), { recursive: true });
	symlinkSync(realpathSync(typescriptDir), join(dir, 'node_modules', 'typescript'), 'dir');
};
