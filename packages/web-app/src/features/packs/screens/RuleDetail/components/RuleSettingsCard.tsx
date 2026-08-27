import type { StandardsPackRuleView } from '@lightsout/engine';
import { CopyButton, DefinitionList, SettingsCard } from '#src/appUI/index.ts';
import type { DefinitionEntry } from '#src/common/types/DefinitionEntry.ts';

/** The config block that replaces one of the rule's numbers, with every number it ships already in it. */
const buildOverrideSnippet = ({ rule }: { rule: StandardsPackRuleView }) =>
	JSON.stringify({ 'standards-checks': { [rule.id]: { settings: rule.defaultSettings } } }, null, '\t');

interface Props {
	rule: StandardsPackRuleView;
}

/**
 * The numbers this rule ships with, and what a repo writes to change one.
 *
 * A rule that sets no numbers renders nothing — most do not, and an empty card
 * saying so on every one of them would be noise.
 */
export const RuleSettingsCard = ({ rule }: Props) => {
	const entries: DefinitionEntry[] = Object.entries(rule.defaultSettings).map(([name, value]) => [
		name,
		<span key={name} className="font-mono">
			{value}
		</span>,
	]);

	return entries.length === 0 ? null : (
		<SettingsCard
			title="Its numbers"
			description="The defaults the pack ships. A repo may set its own."
			action={<CopyButton value={buildOverrideSnippet({ rule })} label="Copy override" />}
		>
			<div className="flex flex-col gap-3">
				<DefinitionList entries={entries} />
				<pre className="overflow-x-auto font-mono text-muted-foreground-strong text-xs">{buildOverrideSnippet({ rule })}</pre>
			</div>
		</SettingsCard>
	);
};
