import { StandardsSeverity } from '@lightsout/engine/contracts';
import { CopyButton, SettingsCard } from '#src/appUI/index.ts';

/** The one config line that changes how loudly a rule speaks, at the severity asked for. */
const buildSeveritySnippet = ({ ruleId, severity }: { ruleId: string; severity: typeof StandardsSeverity.Advisory | typeof StandardsSeverity.Off }) =>
	`"standards-checks": { ${JSON.stringify(ruleId)}: ${JSON.stringify(severity)} }`;

interface Props {
	ruleId: string;
}

/**
 * How a repo disagrees with this rule.
 *
 * Stated plainly rather than buried, because a pack a reader cannot argue with
 * is a pack they fork. Advisory keeps the finding and stops it blocking; off is
 * what a repo writes when its own linter already enforces the rule.
 */
export const TurnItDownCard = ({ ruleId }: Props) => (
	<SettingsCard title="Turn it down" description="Both lines go in your lightsout.config.json.">
		<div className="flex flex-col gap-3">
			{[StandardsSeverity.Advisory, StandardsSeverity.Off].map((severity) => (
				<div key={severity} className="flex flex-wrap items-center justify-between gap-2">
					<pre className="min-w-0 overflow-x-auto font-mono text-muted-foreground-strong text-xs">{buildSeveritySnippet({ ruleId, severity })}</pre>
					<CopyButton value={buildSeveritySnippet({ ruleId, severity })} label={`Copy ${severity}`} />
				</div>
			))}
		</div>
	</SettingsCard>
);
