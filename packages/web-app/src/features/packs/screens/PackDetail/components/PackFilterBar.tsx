import type { StandardsPackRuleListing } from '@lightsout/engine';
import { StandardsSet, StandardsSeverity } from '@lightsout/engine/contracts';
import { Button } from '#src/appUI/index.ts';
import { cn } from '#src/common/utils/cn.ts';
import type { PackRuleFilters } from '#src/features/packs/common/types/PackRuleFilters.ts';

/**
 * One named row of toggles over a closed set of values.
 *
 * The group is named to anything reading the page rather than only to a reader
 * looking at it: two groups offer a toggle spelled `code`, and the group is what
 * says which question each one answers.
 *
 * Pressing the toggle already carrying the filter clears it, so every selection
 * has a way back. A group with fewer than two values to offer draws nothing —
 * the lone toggle would narrow to what the reader is already looking at.
 *
 * One component rather than one per filter: `set`, `channel`, `enforced by` and
 * `severity` differ only in the values they list and the word they show for
 * each, and four copies of this markup would be four places to fix a toggle
 * that stopped clearing itself.
 */
const FilterToggleGroup = <Option,>({
	label,
	options,
	selected,
	toLabel,
	onSelect,
}: {
	label: string;
	options: Option[];
	selected?: Option;
	toLabel: (option: Option) => string;
	onSelect: (option?: Option) => void;
}) => {
	if (options.length < 2) {
		return null;
	}

	return (
		<fieldset aria-label={label} className="flex flex-wrap items-center gap-1 border-0 p-0">
			<span className="text-muted-foreground text-xs">{label}</span>
			{options.map((option) => (
				<Button
					key={toLabel(option)}
					type="button"
					variant="ghost"
					size="sm"
					aria-pressed={selected === option}
					onClick={() => onSelect(selected === option ? undefined : option)}
					className={cn('border border-transparent font-normal', { 'border-border bg-accent text-accent-foreground': selected === option })}
				>
					{toLabel(option)}
				</Button>
			))}
		</fieldset>
	);
};

interface Props {
	rules: StandardsPackRuleListing[];
	filters: PackRuleFilters;
	onChange: (filters: PackRuleFilters) => void;
	/** Rules surviving the current filters — the live count. */
	matchCount: number;
}

/**
 * How a reader narrows a pack's rule list.
 *
 * The whole pack decides the vocabulary, not the current selection: options
 * computed from the filtered list would delete the toggle that was just
 * pressed, and a pack with no tests document would still be offering a "tests"
 * toggle that can only ever match nothing.
 */
export const PackFilterBar = ({ rules, filters, onChange, matchCount }: Props) => {
	const sets = [StandardsSet.Code, StandardsSet.Tests].filter((set) => rules.some((rule) => rule.set === set));
	const severities = [StandardsSeverity.Blocking, StandardsSeverity.Advisory].filter((severity) => rules.some((rule) => rule.defaultSeverity === severity));
	const enforced = [true, false].filter((checked) => rules.some((rule) => rule.checked === checked));
	const channels = [...new Set(rules.map((rule) => rule.channel))].sort();

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
			<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
				<FilterToggleGroup label="set" options={sets} selected={filters.set} toLabel={(set) => set} onSelect={(set) => onChange({ ...filters, set })} />
				<FilterToggleGroup
					label="channel"
					options={channels}
					selected={filters.channel}
					toLabel={(channel) => channel}
					onSelect={(channel) => onChange({ ...filters, channel })}
				/>
				<FilterToggleGroup
					label="enforced by"
					options={enforced}
					selected={filters.checked}
					toLabel={(checked) => (checked ? 'code' : 'judgment')}
					onSelect={(checked) => onChange({ ...filters, checked })}
				/>
				<FilterToggleGroup
					label="severity"
					options={severities}
					selected={filters.severity}
					toLabel={(severity) => severity}
					onSelect={(severity) => onChange({ ...filters, severity })}
				/>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<input
					type="search"
					aria-label="Filter rules by id or summary"
					placeholder="Filter by id or summary"
					value={filters.text ?? ''}
					onChange={(event) => onChange({ ...filters, text: event.target.value === '' ? undefined : event.target.value })}
					className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring"
				/>
				<span className="text-muted-foreground text-xs">
					{matchCount} of {rules.length} rules
				</span>
			</div>
		</div>
	);
};
