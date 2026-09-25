import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { FindingSeverity } from '#src/contracts/plan/grade/FindingSeverity.ts';
import { StructuralCheck } from '#src/contracts/plan/grade/StructuralCheck.ts';
import type { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	/** Absolute paths to the plan file(s) to read, in the order the caller holds them. */
	planPaths: string[];
}

/** A phase file's position in the walk: `overview.md` precedes every phase, and a lone `plan.md` is phase one. */
const phaseNumber = ({ base }: { base: string }) => (base === 'overview.md' ? 0 : Number(/^phase(\d+)-/.exec(base)?.[1] ?? 1));

/**
 * Read and parse every plan file once, so each check reads a `PhaseFile` rather
 * than re-parsing the text. An unreadable file yields its finding here and no
 * `PhaseFile` at all, which is what keeps a path the draft claimed but never
 * wrote from passing the lint silently.
 */
export const readPhaseFiles = async ({ planPaths }: Params): Promise<{ phases: PhaseFile[]; findings: StructuralFinding[] }> => {
	const phases: PhaseFile[] = [];
	const findings: StructuralFinding[] = [];

	for (const planPath of planPaths) {
		const content = await readFile(planPath, 'utf8').catch(() => undefined);
		const base = basename(planPath);

		if (content === undefined) {
			findings.push({
				check: StructuralCheck.SectionsPresent,
				severity: FindingSeverity.Blocking,
				phase: base,
				issue: 'plan file could not be read',
				location: planPath,
				fix: 'ensure the draft wrote the plan file at this path',
			});

			continue;
		}

		phases.push({ path: planPath, base, number: phaseNumber({ base }), plan: parsePlan({ content, base }) });
	}

	return { phases, findings };
};
