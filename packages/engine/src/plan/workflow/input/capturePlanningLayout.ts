import { randomUUID } from 'node:crypto';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary, PlanVariant } from '#src/contracts/index.ts';
import { capturePlanningInput } from '#src/plan/workflow/capturePlanningInput.ts';
import { adoptPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/adoptPlanningExecutionPolicy.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import { readPlanningEntrySnapshot } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	scope: typeof PlanVariant.Overview | typeof PlanVariant.Single;
}

/** A foreground layout flag is a real explicit choice; preserve its exact wording and provenance for every role. */
export const capturePlanningLayout = async ({ runtime, scope: layout }: Params): Promise<void> => {
	const text = `--scope ${layout === PlanVariant.Overview ? 'phased' : 'single'}`;
	const digest = sha256({ content: text });
	let snapshot = await readPlanningEntrySnapshot({ cwd: runtime.cwd, name: runtime.name });
	if (!snapshot?.record.sources.some((source) => source.artifact !== 'foreground-layout.txt'))
		throw new Error('Original feature input is required before choosing its layout');
	snapshot = await adoptPlanningExecutionPolicy({ runtime, snapshot });
	const prior = snapshot.record.claims.find((claim) => claim.id.startsWith('cli-layout:') && claim.state === PlanningVocabulary.ClaimState.Settled);
	if (prior?.text === text) return;
	const id = `cli-layout:${randomUUID()}`;
	const scope = { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] };
	const origin = { artifact: 'foreground-layout.txt', locator: 'Explicit CLI flag', text, sha256: digest };
	await capturePlanningInput({
		runtime,
		expectedGeneration: snapshot.digest,
		input: {
			stage: runtime.stage,
			sources: [origin],
			claims: [
				{
					id,
					kind: PlanningVocabulary.ClaimKind.Decision,
					text,
					explanation: `Use a ${layout === PlanVariant.Overview ? 'phased' : 'single-file'} plan, as explicitly selected by the foreground CLI flag.`,
					contentRevision: (prior?.contentRevision ?? 0) + 1,
					...(prior ? { supersedes: prior.id } : {}),
					origin,
					owner: PlanningVocabulary.Owner.User,
					state: PlanningVocabulary.ClaimState.Settled,
					dependencies: [],
					scope,
					confirmationId: id,
				},
			],
			confirmations: [
				{ id, channel: PlanningVocabulary.ConfirmationChannel.Foreground, messageId: id, messageText: text, approvedDigest: digest, delegation: scope },
			],
		},
	});
};
