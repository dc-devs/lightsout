import type { StandardsPackView } from '#src/contracts/index.ts';
import { toStandardsPackView } from '#src/views/common/utils/toStandardsPackView.ts';
import { getStandardsPackBundle } from '#src/views/getStandardsPackBundle.ts';

interface Params {
	cwd: string;
	name: string;
}

/**
 * One standards pack as its page shows it: its documents and every rule's
 * listing row.
 *
 * @param cwd - the repo whose config decides which packs load
 * @param name - the pack's `name` from its lightsout-standards.json, which is what the URL carried
 * @throws {StandardsPackNotFoundError} When no pack this repo loads answers to the name.
 */
export const getStandardsPackView = async ({ cwd, name }: Params): Promise<StandardsPackView> => {
	const bundle = await getStandardsPackBundle({ cwd, name });

	return toStandardsPackView({ bundle });
};
