import { join } from 'node:path';

interface Params {
	/** The checkout the folder is spelled against — a test's own temp repo, never a resolved primary. */
	cwd: string;
	/** A plan address, or the bare name of a plan shaped before its ticket exists. */
	name: string;
}

/**
 * The folder `planWorkspaceDir` resolves for a name, spelled synchronously so a
 * fixture can seed it with `mkdirSync` before any command runs.
 *
 * It is not that helper: this one never asks git which checkout holds the state,
 * because a fixture already knows — it is the directory it just created.
 */
export const planWorkspaceFolder = ({ cwd, name }: Params): string => {
	const [workOrderName, planId] = name.split('/');
	const plansFolder = join(cwd, '.lightsout', 'work-orders', workOrderName ?? name, 'plans');

	return planId === undefined ? plansFolder : join(plansFolder, planId);
};
