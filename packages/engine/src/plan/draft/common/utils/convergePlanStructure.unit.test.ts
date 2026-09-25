import { describe, expect, jest, test } from '@jest/globals';
import { DraftImplementation } from '#src/contracts/plan/draft/DraftImplementation.ts';
import { PlanVariant } from '#src/contracts/plan/draft/PlanVariant.ts';
import type { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';
import type { DraftContext } from '#src/plan/common/types/DraftContext.ts';
import { convergePlanStructure } from '#src/plan/draft/common/utils/convergePlanStructure.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';
import { planFacts } from '#tests/helpers/planWriterInputs.ts';

// Mocked Imports
// -------------------------
/** The structural repair as the converge step calls it — only the fields these cases read are named. */
interface RepairParams {
	cwd: string;
	name: string;
	planPaths: string[];
	mechanicalRepair?: boolean;
	overviewPath?: string;
}

const mockRepairPlanStructure = jest.fn<(params: RepairParams) => Promise<{ status: 'complete'; findings: StructuralFinding[] }>>();

jest.mock('#src/plan/draft/repairPlanStructure.ts', () => ({
	repairPlanStructure: (params: RepairParams) => mockRepairPlanStructure(params),
}));
// -------------------------

/** A converge step whose repair round converges clean, so what reaches the repair is the only thing a case reads. */
const setupConverge = () => {
	mockRepairPlanStructure.mockResolvedValue({ status: 'complete', findings: [] });

	const context: DraftContext = {
		cwd: '/repo',
		driver: createUncalledDriver({ reason: 'the converge step spawns nothing of its own' }),
		name: 'demo',
		workspaceDir: '/repo/.lightsout/work-orders/demo/plans',
		facts: planFacts(),
		decisions: emptyDecisionsRecord(),
		implementation: DraftImplementation.Focused,
		executorFileLimit: 50,
		timeoutMs: 1_000,
		progress: () => undefined,
	};

	return {
		context,
		planPaths: ['/repo/plans/demo/overview.md', '/repo/plans/demo/phase1-first.md'],
		variant: PlanVariant.Overview,
		reports: [],
		advisories: [] as StructuralFinding[],
	};
};

describe('convergePlanStructure', () => {
	test('forwards the mechanical pass request and the overview path to the structural repair', async () => {
		const converge = setupConverge();

		const converged = await convergePlanStructure({ ...converge, mechanicalRepair: true, overviewPath: '/repo/plans/demo/overview.md' });

		expect(converged.result.status).toBe('complete');
		expect(mockRepairPlanStructure).toHaveBeenCalledWith(expect.objectContaining({ mechanicalRepair: true, overviewPath: '/repo/plans/demo/overview.md' }));
	});

	test('calls the structural repair with no mechanical request when the flow does not ask for one', async () => {
		const converge = setupConverge();

		const converged = await convergePlanStructure(converge);

		const forwarded = mockRepairPlanStructure.mock.calls[0]?.[0];

		expect(converged.result.status).toBe('complete');
		// the legacy flow asks for neither, and a default-on pass here would change
		// what every one of its repair rounds does
		expect(forwarded?.mechanicalRepair).toBeUndefined();
		expect(forwarded?.overviewPath).toBeUndefined();
	});
});
