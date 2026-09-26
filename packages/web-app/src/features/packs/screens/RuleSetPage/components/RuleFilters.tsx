import { Search } from 'lucide-react';
import { CheckKind } from '#src/common/constants/CheckKind.ts';
import { checkKindLabels } from '#src/common/constants/checkKindLabels.ts';
import { cn } from '#src/common/utils/cn.ts';
import type { PackRuleFilters } from '#src/features/packs/common/types/PackRuleFilters.ts';

/** The three ways to narrow by kind of check, in the order a reader scans them. */
const checkOptions: Array<{ label: string; check: CheckKind | undefined }> = [
	{ label: 'All', check: undefined },
	...Object.values(CheckKind).map((check) => ({ label: checkKindLabels[check].short, check })),
];

interface Props {
	filters: PackRuleFilters;
	onFiltersChange: (filters: PackRuleFilters) => void;
}

/** The search box and the kind-of-check switch above the rule list. */
export const RuleFilters = ({ filters, onFiltersChange }: Props) => (
	<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<label className="relative flex w-full items-center sm:max-w-sm">
			<Search aria-hidden="true" className="pointer-events-none absolute left-3.5 size-4 text-subtle-foreground" />
			<input
				type="search"
				value={filters.text ?? ''}
				placeholder="Search rules"
				aria-label="Search rules"
				onChange={(event) => onFiltersChange({ ...filters, text: event.target.value === '' ? undefined : event.target.value })}
				className="h-10 w-full rounded-xl border border-border bg-card pr-3 pl-10 text-foreground text-sm shadow-sm outline-none transition-colors placeholder:text-subtle-foreground focus:border-primary-tint-border focus:ring-2 focus:ring-primary/20"
			/>
		</label>
		<fieldset className="flex gap-1 rounded-xl bg-muted p-1">
			<legend className="sr-only">Kind of check</legend>
			{checkOptions.map((option) => {
				const isActive = filters.check === option.check;

				return (
					<button
						key={option.label}
						type="button"
						aria-pressed={isActive}
						onClick={() => onFiltersChange({ ...filters, check: option.check })}
						className={cn(
							'cursor-pointer rounded-lg px-3 py-1.5 font-semibold text-xs transition-colors',
							isActive ? 'bg-card text-drop-navy shadow-sm' : 'text-muted-foreground hover:text-foreground',
						)}
					>
						{option.label}
					</button>
				);
			})}
		</fieldset>
	</div>
);
