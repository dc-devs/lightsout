import type { LightsoutConfig } from '@/contracts';
import type { ResolvedRuleState } from '@/standardsCheck/common/types/ResolvedRuleState';
import type { LoadedStandardsPackage } from '@/standardsPackages';

interface Params {
	packages: LoadedStandardsPackage[];
	config?: LightsoutConfig;
}

/**
 * Every loaded rule's severity and settings for this run: the rule's own front
 * matter, with the repo's `standards-checks` entries layered over it. A rule the
 * config does not name keeps its default — silence is never a change.
 *
 * Two protections live here because this is the first moment the valid rule ids
 * exist at all. Two packages claiming one id would make config overrides and
 * site keys ambiguous, and a config key naming no loaded rule is a typo that
 * would otherwise disable a policy its author believes is live — the same
 * refusal the closed rule enum used to give while parsing the config file.
 *
 * @throws {Error} When two packages claim one rule id, or a config entry names no loaded rule.
 */
export const resolvePackageRuleStates = ({ packages, config }: Params): Map<string, ResolvedRuleState> => {
	const states = new Map<string, ResolvedRuleState>();
	const owners = new Map<string, string>();

	for (const pkg of packages) {
		for (const rule of pkg.rules) {
			const owner = owners.get(rule.id);

			if (owner !== undefined) {
				throw new Error(`duplicate rule id "${rule.id}": claimed by standards packages "${owner}" and "${pkg.name}"`);
			}

			owners.set(rule.id, pkg.name);
			states.set(rule.id, { severity: rule.defaultSeverity, settings: { ...rule.defaultSettings }, fromConfig: false });
		}
	}

	for (const [id, override] of Object.entries(config?.['standards-checks'] ?? {})) {
		const state = states.get(id);

		if (state === undefined) {
			throw new Error(`standards-checks names "${id}", which no loaded standards package declares — valid rule ids: ${[...states.keys()].sort().join(', ')}`);
		}

		const object = typeof override === 'object' ? override : undefined;

		states.set(id, {
			severity: (typeof override === 'string' ? override : object?.severity) ?? state.severity,
			settings: { ...state.settings, ...object?.settings },
			fromConfig: true,
		});
	}

	return states;
};
