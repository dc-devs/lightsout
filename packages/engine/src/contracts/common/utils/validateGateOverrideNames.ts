import type { z } from 'zod';
import type { ConfigGates } from '#src/contracts/ConfigGates.ts';
import { uncheckpointableGateKeys } from '#src/contracts/common/constants/uncheckpointableGateKeys.ts';
import type { GateOverrides } from '#src/contracts/GateOverrides.ts';
import type { PackageGates } from '#src/contracts/PackageGates.ts';

interface Params {
	overrides: GateOverrides | undefined;
	gates: ConfigGates;
	packageGates: PackageGates | undefined;
	ctx: z.RefinementCtx;
}

/**
 * Every gate a `gate-overrides` list names must be a gate this repo configured,
 * under either gate block.
 *
 * An override is keyed by checkpoint rather than by package, so it schedules
 * whichever groups run there — which is why a suite configured only under
 * `package-gates` is a legal name and does not have to be written into the root
 * block as well. A key whose value is the literal `false` is the explicit
 * coverage opt-out, so it is a gate the repo does not have: scheduling it would
 * be a silent no-op.
 */
export const validateGateOverrideNames = ({ overrides, gates, packageGates, ctx }: Params): void => {
	const blocks = packageGates === undefined ? [gates] : [gates, packageGates];
	const configured = new Set(
		blocks
			.flatMap((block) => Object.entries(block))
			.filter(([key, command]) => !Object.hasOwn(uncheckpointableGateKeys, key) && command !== false)
			.map(([key]) => key),
	);

	for (const [checkpoint, entry] of Object.entries(overrides ?? {})) {
		for (const name of Array.isArray(entry) ? entry : []) {
			if (!configured.has(name)) {
				ctx.addIssue({
					code: 'custom',
					message: `unknown gate '${name}' in gate-overrides.${checkpoint} — name a gate this repo configures under \`gates\` or \`package-gates\``,
				});
			}
		}
	}
};
