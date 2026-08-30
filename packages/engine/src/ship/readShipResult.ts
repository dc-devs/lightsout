import { readFile } from 'node:fs/promises';
import { ShipResult } from '#src/contracts/index.ts';
import { getShipResultPath } from '#src/ship/common/utils/getShipResultPath.ts';

interface Params {
	cwd: string;
	branch: string;
}

/**
 * The ship result filed for a branch, or undefined when none was ever written,
 * the file is unreadable, or its contents do not satisfy the contract.
 *
 * Results are filed per BRANCH, not per run, so this answers "what happened
 * the last time this branch was shipped" — which is the right answer for the
 * run currently on it, and the only one the on-disk layout can give.
 */
export const readShipResult = async ({ cwd, branch }: Params): Promise<ShipResult | undefined> => {
	const raw = await readFile(getShipResultPath({ cwd, branch }), 'utf8').catch(() => undefined);

	if (raw === undefined) {
		return undefined;
	}

	try {
		const parsed = ShipResult.safeParse(JSON.parse(raw));

		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
};
