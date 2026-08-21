import type { StandardsFinding } from '#src/contracts/index.ts';
import { buildBatchFixInvocation } from '#src/refactor/batch/buildBatchFixInvocation.ts';
import { standaloneBanner } from '#src/refactor/batch/common/constants/standaloneBanner.ts';
import type { BatchTools } from '#src/refactor/batch/common/types/BatchTools.ts';
import type { settleBatchGates } from '#src/refactor/batch/settleBatchGates.ts';

interface Params {
	tools: BatchTools;
	files: string[];
	workFindings: StandardsFinding[];
	advisories: StandardsFinding[];
	standards?: string;
	testStandards?: string;
}

/**
 * The gate-fix invoker the gate settler calls: the calling pass's context, plus
 * the gate output that sent the work back.
 *
 * Every pass that can turn a gate red builds one of these — the executor pass
 * and the polish pass alike — and they must build it the same way, or a gate
 * red in one would reach the fixing agent with a different account of the work
 * than the same red in the other.
 */
export const createFixInvoker =
	({ tools, files, workFindings, advisories, standards, testStandards }: Params): Parameters<typeof settleBatchGates>[0]['invokeFix'] =>
	({ label, gateError, guidance }) =>
		tools.invoke({
			label,
			invocation: buildBatchFixInvocation({
				planContent: standaloneBanner,
				files,
				standards,
				testStandards,
				findings: workFindings,
				advisories,
				gateError,
				guidance,
			}),
		});
