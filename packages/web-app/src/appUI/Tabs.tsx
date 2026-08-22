import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { cn } from '#src/common/utils/cn.ts';

interface TabItem {
	value: string;
	label: ReactNode;
	content: ReactNode;
}

interface Props {
	items: TabItem[];
	/** Uncontrolled starting tab; defaults to the first item. */
	defaultValue?: string;
	/** Controlled value; when given, `onValueChange` must be too. */
	value?: string;
	onValueChange?: (value: string) => void;
	className?: string;
}

/**
 * A themed tab strip over its panels.
 *
 * Driven by an items array rather than by compound children, so the file holds
 * one export and a caller states its tabs as data — which is what lets a page
 * build them from an engine view instead of hand-writing a trigger each.
 */
export const Tabs = ({ items, defaultValue, value, onValueChange, className }: Props) => (
	<TabsPrimitive.Root
		defaultValue={defaultValue ?? items[0]?.value}
		value={value}
		onValueChange={onValueChange}
		className={cn('flex flex-col gap-4', className)}
	>
		<TabsPrimitive.List className="flex min-w-0 gap-1 overflow-x-auto border-border border-b">
			{items.map((item) => (
				<TabsPrimitive.Trigger
					key={item.value}
					value={item.value}
					className="-mb-px shrink-0 whitespace-nowrap border-transparent border-b-2 px-3 py-2 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground"
				>
					{item.label}
				</TabsPrimitive.Trigger>
			))}
		</TabsPrimitive.List>
		{items.map((item) => (
			<TabsPrimitive.Content key={item.value} value={item.value} className="min-w-0 outline-none">
				{item.content}
			</TabsPrimitive.Content>
		))}
	</TabsPrimitive.Root>
);
