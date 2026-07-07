import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type ts from 'typescript';
import { isInertSourceFile } from '../isInertSourceFile';
import type { PipelineRun } from '../PipelineRun';

interface Params {
	run: PipelineRun;
	candidates: string[];
	/** The consumer's TypeScript module, or undefined — nothing is filtered without one. */
	compiler: typeof ts | undefined;
}

/**
 * Inert-file filter for the write-tests fan-out: barrels and type-only
 * files provably hold no executable code, so a writer per file is a
 * guaranteed no-op spawn (or worse, an implementation-coupled test the
 * standards forbid). Classification borrows the consumer's TypeScript,
 * exactly like the scan's AST tier; without one, nothing is filtered —
 * the degraded path is the old behavior, never a lost writer.
 */
export const selectTestTargets = async ({ run, candidates, compiler }: Params): Promise<{ targets: string[]; inert: string[] }> => {
	if (!compiler) {
		return { targets: candidates, inert: [] };
	}

	const targets: string[] = [];
	const inert: string[] = [];

	for (const file of candidates) {
		const content = await readFile(join(run.cwd, file), 'utf8').catch(() => undefined);

		// Unreadable (deleted mid-run) keeps its writer — same as before.
		if (content !== undefined && isInertSourceFile({ path: file, content, compiler })) {
			inert.push(file);
		} else {
			targets.push(file);
		}
	}

	return { targets, inert };
};
