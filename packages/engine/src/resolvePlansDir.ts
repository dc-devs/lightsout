import { isAbsolute, join } from 'node:path';
import type { LightsoutConfig } from '@lightsout/contracts';

interface Params {
	cwd: string;
	/** CLI `--plans` override, when given. */
	flag?: string;
	config?: LightsoutConfig;
}

/**
 * Resolve where committed plan deliverables live: flag → `config.plansDir` →
 * default `.claude/plans`, then absolutized against cwd. Unlike the transient
 * workspace, this is a human-reviewed, committed path that feeds `implement`.
 */
export const resolvePlansDir = ({ cwd, flag, config }: Params): string => {
	const dir = flag ?? config?.plansDir ?? '.claude/plans';

	return isAbsolute(dir) ? dir : join(cwd, dir);
};
