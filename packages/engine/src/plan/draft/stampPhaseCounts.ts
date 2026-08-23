import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import type { PhaseSizeCounts } from '#src/plan/common/types/PhaseSizeCounts.ts';
import { getPlanTouchedPaths } from '#src/plan/common/utils/getPlanTouchedPaths.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	/** Absolute path of the overview to rewrite in place. */
	overviewPath: string;
	/** Absolute paths of the authored phase files. */
	phasePaths: string[];
}

/** What each authored phase file really creates and touches, keyed by its basename. */
const getCounts = async ({ phasePaths }: { phasePaths: string[] }) => {
	const counts = new Map<string, PhaseSizeCounts>();

	for (const phasePath of phasePaths) {
		const base = basename(phasePath);
		const { created, touched } = getPlanTouchedPaths({ plan: parsePlan({ content: await readFile(phasePath, 'utf8'), base }) });

		counts.set(base, { created: created.length, touched: touched.length });
	}

	return counts;
};

/**
 * The overview's lines with the `Creates` and `Touches` cells of each
 * `## Phases` row rewritten, and every other character left alone.
 *
 * A row is matched by the phase filename it names — unique per row, and spelled
 * the same whether the cell backticks it or not — rather than by re-parsing the
 * cell, so this needs no second copy of the table parser's cell rules.
 */
const rewriteRows = ({ lines, counts }: { lines: string[]; counts: Map<string, PhaseSizeCounts> }) => {
	const bases = [...counts.keys()];
	let inPhases = false;

	return lines.map((line) => {
		const heading = /^##\s+(.+?)\s*$/.exec(line);

		if (heading) {
			inPhases = heading[1] === 'Phases';

			return line;
		}

		const base = inPhases && line.trim().startsWith('|') ? bases.find((candidate) => line.includes(candidate)) : undefined;
		const size = base === undefined ? undefined : counts.get(base);

		if (size === undefined) {
			return line;
		}

		const indent = /^\s*/.exec(line)?.[0] ?? '';
		const cells = line.trim().split('|').slice(1, -1);

		cells[3] = ` ${size.created} `;
		cells[4] = ` ${size.touched} `;

		return `${indent}|${cells.join('|')}|`;
	});
};

/**
 * Recompute each phase's created and touched source-file counts from the phase
 * files the fan-out just wrote, and write them back into the `Creates` and
 * `Touches` cells of the overview's `## Phases` table. Nothing else is
 * rewritten.
 *
 * The overview is authored BEFORE any phase file exists, so its counts are the
 * overview agent's estimate. The consistency check demands they equal the real
 * numbers — which, without this, every phase whose author landed one file either
 * side of the estimate would fail, and the structural repair loop would spend
 * its three agent attempts on arithmetic. Determinism belongs in the engine:
 * once the phase files exist the counts are a fact, not a judgment, so the
 * engine states them and the consistency check goes back to doing what it is
 * for — catching a human edit that drifts the overview from the phases.
 *
 * The `- **File budget:**` bullet is deliberately NOT stamped. A budget is a
 * declaration that a phase is meant to be large, not a measurement of it, and
 * the consistency rules require the overview's bullet to equal the phase file's
 * own `## File Budget` — a value only the phase agent authors. Stamping it would
 * either overwrite a real declaration with a count or leave the two copies
 * disagreeing. A phase whose real touched count exceeds its budget is a genuine
 * defect, and the consistency check is what reports it.
 *
 * The scope text and the declared creates, exports and scripts are likewise the
 * overview agent's and are left exactly as written — those are claims the
 * consistency check must still be able to fail.
 */
export const stampPhaseCounts = async ({ overviewPath, phasePaths }: Params): Promise<PhaseDeclaration[]> => {
	const counts = await getCounts({ phasePaths });
	const overviewBase = basename(overviewPath);
	const original = await readFile(overviewPath, 'utf8');
	const stamped = rewriteRows({ lines: original.split('\n'), counts }).join('\n');

	await writeFile(overviewPath, stamped, 'utf8');

	return parsePhaseDeclarations({ plan: parsePlan({ content: stamped, base: overviewBase }) });
};
