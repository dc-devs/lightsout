import { readdir } from 'node:fs/promises';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { planWorkspaceDir } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	/** The --plan value exactly as the user gave it. */
	name: string;
}

/**
 * What a `--plan` value addresses: one plan, or every plan of a ticket folder.
 *
 * Three answers, in this order. A name that parses as a plan address and whose
 * folder is there is that one plan. A plans folder holding plan subfolders is a
 * ticket folder, and contributes every plan's address in plan-id order — a
 * ticket's plans are the unit a person paid for, so asking what a ticket cost
 * must not need several commands and hand arithmetic. A plans folder holding no
 * plan subfolder is a legacy plan folder, named for its branch alone the way
 * every plan was before ticket records existed, and reports under its own name.
 *
 * Anything else answers an error naming the value and the folder that was
 * searched, so a reader can see which checkout answered. A branch whose ticket
 * folder holds no plans folder at all is one of those: it never carried a plan,
 * so it is no plan rather than a loose-file one. It never exits and never
 * prints: the command owns the exit code and the output.
 *
 * It asks `parsePlanAddress` for the address shape rather than splitting a name
 * itself, which is the rule that function's own doc comment sets. It is not
 * `resolvePlanTarget`, which answers which deliverable file inside a folder a
 * run should build from — a different question.
 */
export const resolveReportTargets = async ({ cwd, name }: Params): Promise<{ names: string[]; ticketFolder: boolean } | { error: string }> => {
	const folder = await planWorkspaceDir({ cwd, name });
	const children = await readdir(folder, { withFileTypes: true }).catch(() => undefined);

	if (children === undefined) {
		return { error: `no plan folder named '${name}' under ${folder}` };
	}

	const plans = children
		.filter((child) => child.isDirectory())
		.map((child) => formatPlanAddress({ ticketBranch: name, planId: child.name }))
		.filter((address) => parsePlanAddress({ name: address }) !== undefined)
		.sort();

	// An addressed name is one plan whatever it happens to hold, so a plan folder
	// that grew a subdirectory of its own is never read as a ticket.
	return parsePlanAddress({ name }) !== undefined || plans.length === 0 ? { names: [name], ticketFolder: false } : { names: plans, ticketFolder: true };
};
