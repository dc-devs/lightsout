import { readJsonFile } from '#src/common/utils/readJsonFile.ts';
import { StandardsSnapshot } from '#src/contracts/index.ts';
import { getRunStandardsBaselinePath } from '#src/runState/standardsBaseline/getRunStandardsBaselinePath.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * One run's pre-edit standards baseline, validated at the boundary.
 *
 * `undefined` when the file is absent, will not parse as JSON, or fails the
 * contract — never a throw. A run created before the baseline existed and
 * resumed past clean-slate has no file, and one written by an older engine is no
 * more readable than a missing one; both mean "no comparison point", which is a
 * state cleanup has to render rather than an error.
 */
export const readRunStandardsBaseline = async ({ cwd, runId }: Params): Promise<StandardsSnapshot | undefined> => {
	return readJsonFile({ path: getRunStandardsBaselinePath({ cwd, runId }), schema: StandardsSnapshot });
};
