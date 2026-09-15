import { PlanningInput, type PlanningRecord } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { commitPlanningSnapshot } from '#src/plan/workflow/store/commitPlanningSnapshot.ts';
import { captureLegacyRunInputs } from '#src/plan/workflow/store/common/migration/captureLegacyRunInputs.ts';
import { importLegacyDecisions } from '#src/plan/workflow/store/common/migration/importLegacyDecisions.ts';
import { importLegacyFindings } from '#src/plan/workflow/store/common/migration/importLegacyFindings.ts';
import type { PlanningImportInputs } from '#src/plan/workflow/store/common/types/PlanningImportInputs.ts';
import { initialPlanningWork } from '#src/plan/workflow/store/common/utils/initialPlanningWork.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/readPlanningSnapshot.ts';

interface Params {
	cwd: string;
	name: string;
	inputs: PlanningImportInputs;
}

/** Import once without rewriting original files, old run manifests or the meaning of their answers. */
export const importPlanningWorkspace = async ({ cwd, name, inputs }: Params): Promise<PlanningSnapshot> => {
	const current = await readPlanningSnapshot({ cwd, name });
	if (current !== undefined) return current;
	const input = PlanningInput.parse(inputs.input);
	const record: PlanningRecord = {
		schemaVersion: 1,
		planName: name,
		revision: 0,
		parentDigest: null,
		sources: [...input.sources, ...(inputs.sources ?? [])],
		claims: [...input.claims],
		evidence: [],
		work: initialPlanningWork({ input }),
		findings: [],
		reviewReceipts: [],
		artifacts: inputs.artifacts.map((item) => item.descriptor),
		confirmations: [...input.confirmations],
		standards: [],
	};
	const artifacts = new Map(inputs.artifacts.map((item) => [item.descriptor.path, item.content]));
	if (artifacts.size !== inputs.artifacts.length) throw new Error('Import contains duplicate artifact paths');
	importLegacyDecisions({ record, artifacts, sources: inputs.legacyDecisions ?? [] });
	importLegacyFindings({ record, artifacts, source: inputs.legacyFindings });
	await captureLegacyRunInputs({ cwd, name, record, artifacts });
	const result = await commitPlanningSnapshot({ cwd, name, expectedRevision: -1, parentDigest: null, record, artifacts });
	return result.committed ? result.snapshot : result.current;
};
