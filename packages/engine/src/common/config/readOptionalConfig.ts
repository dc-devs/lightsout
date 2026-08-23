import { join } from 'node:path';
import { parseConfig } from '#src/common/config/parseConfig.ts';
import { readConfigFile } from '#src/common/config/readConfigFile.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
}

/**
 * The config when the repo has one, `undefined` when it has none — and a throw
 * when it has one that does not parse.
 *
 * That third case is the point. Commands that can run without a config used to
 * spell this `readConfig(...).catch(() => undefined)`, which cannot tell "this
 * repo has no config" from "this repo's config is broken" and answered both
 * with the defaults. Measured on this repo: one illegal `package-gates` key
 * that `doctor` refused by name took `standards-check` from 790 source files to
 * 909 — the `generated` list was gone, so the web app's generated route tree
 * was read as source — and from 3 blocking findings to 10, with nothing in the
 * output saying the config had been ignored. It read as a code regression and
 * took a bisect of the config to find.
 *
 * A repo with no config gets defaults nobody has to choose. A repo with a
 * broken one gets told.
 */
export const readOptionalConfig = async ({ cwd }: Params): Promise<LightsoutConfig | undefined> => {
	const configPath = join(cwd, 'lightsout.config.json');
	const raw = await readConfigFile({ configPath });

	return raw === undefined ? undefined : parseConfig({ raw, configPath });
};
