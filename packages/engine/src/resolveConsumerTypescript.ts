import { createRequire } from 'node:module';
import { join } from 'node:path';
import type ts from 'typescript';

interface Params {
	cwd: string;
}

/**
 * The target repo's own TypeScript module, or undefined when it has none.
 * Bundling the compiler into the committed CLI bundle would add ~8MB for a
 * dependency every TS consumer already has — so the AST tier borrows the
 * consumer's and degrades honestly when absent (JS-only repos).
 */
export const resolveConsumerTypescript = ({ cwd }: Params) => {
	try {
		const require = createRequire(join(cwd, 'package.json'));

		return require('typescript') as typeof ts;
	} catch {
		return undefined;
	}
};
