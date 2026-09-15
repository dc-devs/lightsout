import { isAbsolute, resolve } from 'node:path';
import { resolveDefaultStandardsPack } from '#src/standardsPacks/resolveDefaultStandardsPack.ts';

interface Params {
	cwd: string;
	standardsPacks: string[] | false | undefined;
}

/** The roots the config asks for, absolute — its three-way meaning stated once. */
export const resolveStandardsPackRoots = ({ cwd, standardsPacks }: Params): string[] => {
	if (standardsPacks === false) {
		return [];
	}

	if (standardsPacks === undefined) {
		return [resolveDefaultStandardsPack()];
	}

	return standardsPacks.map((entry) => (isAbsolute(entry) ? entry : resolve(cwd, entry)));
};
