import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { runCli } from '#tests/helpers/runCli.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';

interface Params {
	/** Accept the planted findings as debt first, so the suppression and --all paths are reachable. */
	baseline?: boolean;
	/** Extra top-level config fields — a lightsout.config.json is written only when this is given. */
	config?: Record<string, unknown>;
}

/**
 * A repo with a planted tier-0 synonym pair split across two folders, and no
 * node_modules — so the compiler-gated tiers degrade to a note, which is the
 * other rendering path `standards-check` owns.
 */
export const seedStandardsFixture = async ({ baseline = false, config }: Params = {}): Promise<{ cwd: string }> => {
	const cwd = config ? await seedConfiguredCwd({ config }) : await freshCwd();

	await mkdir(join(cwd, 'src', 'a'), { recursive: true });
	await mkdir(join(cwd, 'src', 'b'), { recursive: true });
	await writeFile(join(cwd, 'src', 'a', 'getUserData.ts'), 'export const getUserData = () => 1;\n', 'utf8');
	await writeFile(join(cwd, 'src', 'b', 'fetchUserData.ts'), 'export const fetchUserData = () => 2;\n', 'utf8');

	if (baseline) {
		await runCli({ args: ['standards-check', '--code-checks', '--baseline', '--cwd', cwd] });
	}

	return { cwd };
};
