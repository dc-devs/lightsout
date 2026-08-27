import type { StandardsPackRuleListing } from '@lightsout/engine';
import { Link } from '@tanstack/react-router';
import { SectionHeader } from '#src/appUI/index.ts';
import { getCapRules } from '#src/features/packs/common/utils/getCapRules.ts';

interface Props {
	rules: StandardsPackRuleListing[];
	packName: string;
}

/**
 * Every number the pack enforces, each one a link to the rule that enforces it.
 *
 * The numbers come off the pack rather than out of this file, so a cap tuned in
 * the pack changes what the strip says. A pack that sets no numbers renders
 * nothing, heading included.
 */
export const CapsStrip = ({ rules, packName }: Props) => {
	const caps = getCapRules({ rules });

	return caps.length === 0 ? null : (
		<section aria-label="The caps" className="flex flex-col gap-3">
			<SectionHeader title="The caps" description="Past the cap, it graduates." />
			<div className="flex flex-wrap gap-2">
				{caps.flatMap((rule) =>
					rule.settings.map((setting) => (
						<Link
							key={`${rule.id}·${setting.name}`}
							to="/standards/$pack/$rule"
							params={{ pack: packName, rule: rule.id }}
							className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 font-mono text-muted-foreground-strong text-xs transition-colors hover:border-primary hover:text-foreground"
						>
							{`${rule.id} · ${setting.name} = ${setting.value}`}
						</Link>
					)),
				)}
			</div>
		</section>
	);
};
