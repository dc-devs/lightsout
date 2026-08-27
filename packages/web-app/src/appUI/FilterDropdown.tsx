import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '#src/appUI/buttons/Button.tsx';

/** One value a reader may narrow to, with how many rows carry it. */
interface FilterOption {
	value: string;
	label: ReactNode;
	count?: number;
}

interface Props {
	label: string;
	options: FilterOption[];
	/** Selected values; empty means no filter. */
	selected: string[];
	onChange: (selected: string[]) => void;
	/** Single-select collapses to at most one value. Defaults to multi-select. */
	multiple?: boolean;
}

/**
 * A named set of values a reader narrows a table by.
 *
 * The trigger carries how many are selected rather than listing them, so a
 * filter bar stays one row wide however many values a reader has picked.
 * Pressing a selected value clears it, which is the way back out of every
 * selection.
 */
export const FilterDropdown = ({ label, options, selected, onChange, multiple = true }: Props) => {
	const toggle = ({ value }: { value: string }) => {
		const without = selected.filter((entry) => entry !== value);
		let next = [value];

		if (without.length !== selected.length) {
			next = without;
		} else if (multiple) {
			next = [...selected, value];
		}

		onChange(next);
	};

	return (
		<PopoverPrimitive.Root>
			<PopoverPrimitive.Trigger asChild>
				<Button type="button" variant="outline" size="sm" className="font-normal">
					{label}
					{selected.length === 0 ? null : <span className="rounded-sm bg-accent px-1 text-accent-foreground text-xs">{selected.length}</span>}
					<ChevronDown aria-hidden="true" className="size-3.5" />
				</Button>
			</PopoverPrimitive.Trigger>
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					align="start"
					sideOffset={4}
					className="z-50 flex max-h-72 min-w-48 flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
				>
					{options.map((option) => (
						<CheckboxPrimitive.Root
							key={option.value}
							checked={selected.includes(option.value)}
							onCheckedChange={() => toggle({ value: option.value })}
							className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
						>
							<span className="flex size-4 shrink-0 items-center justify-center rounded-sm border border-border">
								<CheckboxPrimitive.Indicator className="flex size-full items-center justify-center rounded-sm bg-primary text-primary-foreground">
									<Check aria-hidden="true" className="size-3" />
								</CheckboxPrimitive.Indicator>
							</span>
							<span className="min-w-0 flex-1 truncate">{option.label}</span>
							{option.count === undefined ? null : <span className="text-muted-foreground text-xs">{option.count}</span>}
						</CheckboxPrimitive.Root>
					))}
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
};
