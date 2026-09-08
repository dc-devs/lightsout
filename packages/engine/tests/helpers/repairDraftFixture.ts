import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DecisionsRecord, LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { repairPlanStructure } from '#src/plan/index.ts';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** A drafted plan on disk plus its workspace dir, ready for the repair loop. */
export const setupRepairDraft = ({ body }: { body: string }) => {
	const cwd = setupConsumerRepo();
	const workspaceDir = join(cwd, '.lightsout', 'plans', 'demo');
	const planPath = join(workspaceDir, 'plan.md');

	mkdirSync(workspaceDir, { recursive: true });
	writeFileSync(planPath, body);

	return { cwd, workspaceDir, planPath };
};

/** A repairer that rewrites the plan with successive bodies — or hands the call to `respond` when given. */
export const createRepairDriver = ({
	bodies = [],
	onCall,
	respond,
}: {
	bodies?: string[];
	onCall?: (prompt: string) => void;
	respond?: ({ path }: { path: string }) => { text: string; exitCode: number; rateLimited?: boolean };
}): Driver => {
	let call = 0;

	return {
		name: 'stub',
		invoke: async ({ prompt }) => {
			onCall?.(prompt);

			const path = /- (\S+plan\.md)/.exec(prompt)?.[1] ?? '';

			if (respond) {
				return respond({ path });
			}

			const body = bodies[Math.min(call, bodies.length - 1)] ?? '';

			call += 1;
			writeFileSync(path, body);

			return { text: JSON.stringify({ status: 'fixed', filesEdited: [path], discrepancies: [] }), exitCode: 0 };
		},
	};
};

/** The repair loop over one drafted plan, with the arguments no case varies filled in. */
export const runRepairLoop = ({
	cwd,
	workspaceDir,
	planPath,
	driver,
	config,
	decisions = emptyDecisionsRecord(),
	progress = () => {},
}: {
	cwd: string;
	workspaceDir: string;
	planPath: string;
	driver: Driver;
	config?: LightsoutConfig;
	decisions?: DecisionsRecord;
	progress?: (message: string) => void;
}) => repairPlanStructure({ cwd, driver, name: 'demo', planPaths: [planPath], workspaceDir, config, decisions, timeoutMs: 60_000, progress });
