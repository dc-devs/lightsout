import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LightsoutConfig } from '@/contracts';
import type { DoctorCheck } from '@/doctor/common/types/DoctorCheck';
import type { PackageDir } from '@/doctor/common/types/PackageDir';

interface Params {
	config: LightsoutConfig;
	packageDirs: PackageDir[];
}

/**
 * The standards' mechanical rules (import type, no any) assume the consumer's
 * linter enforces them — lightsout ships no lint preset (hard rule), so the
 * doctor is where the gap surfaces. A consumer that opted out of standards
 * entirely (`standards-packages`: false) has opted out of this too.
 */
export const checkLintRules = async ({ config, packageDirs }: Params): Promise<DoctorCheck | undefined> => {
	if (config['standards-packages'] === false) {
		return undefined;
	}

	const lintFindings: string[] = [];
	let lintConfigCount = 0;

	for (const { label, dir } of packageDirs) {
		const entries: string[] = await readdir(dir).catch(() => []);
		const lintConfigs = entries.filter(
			(name) => /^biome\.jsonc?$/.test(name) || /^eslint\.config\.(js|cjs|mjs|ts)$/.test(name) || /^\.eslintrc(\..+)?$/.test(name),
		);

		for (const name of lintConfigs) {
			lintConfigCount += 1;

			const text = await readFile(join(dir, name), 'utf8').catch(() => '');
			const rules = name.startsWith('biome') ? ['useImportType', 'noExplicitAny'] : ['consistent-type-imports', 'no-explicit-any'];
			const unenforced = rules.filter((rule) => !text.includes(rule) || new RegExp(`${rule}"?\\s*:\\s*"off"`).test(text));

			if (unenforced.length > 0) {
				lintFindings.push(`${label}: ${name} — ${unenforced.join(', ')} missing or disabled`);
			}
		}
	}

	return lintConfigCount === 0
		? {
				id: 'lint-rules',
				status: 'note',
				detail: "no linter config found (biome.json / eslint) — the standards' mechanical rules (import type, no any) run unenforced",
			}
		: lintFindings.length === 0
			? { id: 'lint-rules', status: 'pass', detail: `mechanical rules enforced across ${lintConfigCount} lint config(s)` }
			: {
					id: 'lint-rules',
					status: 'note',
					detail: `${lintFindings.join('; ')} — the standards state these rules as binding; enabling them makes the linter catch what agents miss`,
				};
};
