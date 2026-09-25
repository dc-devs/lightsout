import { StandardsSeverity } from '@lightsout/engine/contracts';
import { CopyButton } from '#src/appUI/buttons/CopyButton.tsx';
import { SettingsCard } from '#src/appUI/panels/SettingsCard.tsx';

/** The one config line that sets how loudly a rule speaks, at the severity asked for. */
const buildSeveritySnippet = ({ ruleId, severity }: { ruleId: string; severity: StandardsSeverity }) =>
	`"standards-checks": { ${JSON.stringify(ruleId)}: ${JSON.stringify(severity)} }`;

interface Props {
	ruleId: string;
	/** What the pack ships the rule at, which decides whether the card turns it down or on. */
	defaultSeverity: StandardsSeverity;
}

/**
 * How a repo changes what this rule does to it.
 *
 * Stated plainly rather than buried, because a pack a reader cannot argue with
 * is a pack they fork. A rule the pack ships on is turned down: advisory keeps
 * the finding and stops it blocking, and off is what a repo writes when its own
 * linter already enforces the rule. A rule the pack ships off is one a repo opts
 * into, so the card offers the two ways to turn it on instead.
 */
export const SeverityOverrideCard = ({ ruleId, defaultSeverity }: Props) => {
	const optIn = defaultSeverity === StandardsSeverity.Off;
	const severities = optIn ? [StandardsSeverity.Blocking, StandardsSeverity.Advisory] : [StandardsSeverity.Advisory, StandardsSeverity.Off];

	return (
		<SettingsCard title={optIn ? 'Turn it on' : 'Turn it down'} description="Both lines go in your lightsout.config.json.">
			<div className="flex flex-col gap-3">
				{severities.map((severity) => (
					<div key={severity} className="flex flex-wrap items-center justify-between gap-2">
						<pre className="min-w-0 overflow-x-auto font-mono text-muted-foreground-strong text-xs">{buildSeveritySnippet({ ruleId, severity })}</pre>
						<CopyButton value={buildSeveritySnippet({ ruleId, severity })} label={`Copy ${severity}`} />
					</div>
				))}
			</div>
		</SettingsCard>
	);
};
