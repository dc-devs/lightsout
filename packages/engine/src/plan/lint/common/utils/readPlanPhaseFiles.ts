import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import type { CanonicalPlanningPhase } from '#src/plan/common/types/CanonicalPlanningPhase.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	planPaths: string[];
	canonicalPhases?: CanonicalPlanningPhase[];
}
const phaseNumber = ({ base }: { base: string }) => (base === 'overview.md' ? 0 : Number(/^phase(\d+)-/.exec(base)?.[1] ?? 1));

/** Read and parse every plan file once, so each check reads a `PhaseFile` rather than re-parsing the text. An unreadable file yields its finding here and no `PhaseFile` at all. */
export const readPlanPhaseFiles = async ({ planPaths, canonicalPhases }: Params): Promise<{ phases: PhaseFile[]; findings: StructuralFinding[] }> => {
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

		phases.push({
			path: planPath,
			base,
			number: canonicalPhases && base !== 'overview.md' ? canonicalPhases.findIndex((phase) => phase.file === base) + 1 : phaseNumber({ base }),
			plan: parsePlan({ content, base }),
		});
	}

	return { phases, findings };
};
