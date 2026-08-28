import { runGh } from '#src/ship/forge/runGh.ts';

interface Params {
	cwd: string;
}

/**
 * Whether `gh` can speak for this repository's host.
 *
 * One boolean rather than a reason, because both ways it can answer no — the
 * binary is not installed, or it is installed and logged out — need the same
 * fix from the same person, and ship's block message names both.
 */
export const readForgeAuth = async ({ cwd }: Params): Promise<boolean> => {
	const status = await runGh({ args: ['auth', 'status'], cwd });

	return status.exitCode === 0;
};
