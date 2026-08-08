import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { BrainstormDecisions } from '@/contracts';
import { planWorkspaceDir } from '@/plan/planWorkspaceDir';
import { readPlanWorkspaceFile } from '@/plan/common/utils/readPlanWorkspaceFile';

const brainstormDecisionsFile = 'brainstorm-decisions.json';

interface Params {
	cwd: string;
	/** Kebab plan name — the workspace key. */
	name: string;
}

/**
 * Read the optional brainstorm-authored decisions for a plan workspace. Absent
 * file → `undefined`: most plans start from a direct request and never went
 * through `/brainstorm`, so absence is a normal path rather than an error.
 * Present but malformed → throws, because drafting on from decisions the user
 * settled and the engine could not read would re-open them for no reason.
 */
export const readBrainstormDecisions = async ({ cwd, name }: Params): Promise<BrainstormDecisions | undefined> => {
	const filePath = join(planWorkspaceDir({ cwd, name }), brainstormDecisionsFile);
	const present = await access(filePath).then(
		() => true,
		() => false,
	);

	if (!present) {
		return undefined;
	}

	return readPlanWorkspaceFile({
		cwd,
		name,
		fileName: brainstormDecisionsFile,
		schema: BrainstormDecisions,
		notFound: (path) => `brainstorm decisions for plan ${name} at ${path} became unreadable during drafting`,
	});
};
