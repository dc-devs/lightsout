import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { TabsVariant } from '#src/common/constants/TabsVariant.ts';
import { cn } from '#src/common/utils/cn.ts';

interface TabItem {
	value: string;
	label: ReactNode;
	content: ReactNode;
}

/** The strip and each trigger, per look. The panels below are the same either way. */
const variantClasses: Record<TabsVariant, { root: string; list: string; trigger: string }> = {
	[TabsVariant.Underline]: {
		root: 'flex flex-col gap-4',
		list: 'flex min-w-0 gap-1 overflow-x-auto border-border border-b',
		trigger:
			'-mb-px shrink-0 whitespace-nowrap border-transparent border-b-2 px-3 py-2 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground',
	},
	// Tabs stacked as cards on the left, the panel beside them; one column on a narrow screen.
	[TabsVariant.Side]: {
		root: 'grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16',
		list: 'flex min-w-0 flex-col gap-3',
		trigger:
			'cursor-pointer rounded-2xl border border-transparent p-5 text-left transition-all hover:bg-muted/50 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-lg',
	},
};

interface Props {
	items: TabItem[];
	/** Defaults to the underline strip every page-level tab set uses. */
	variant?: TabsVariant;
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
export const Tabs = ({ items, variant = TabsVariant.Underline, defaultValue, value, onValueChange, className }: Props) => (
	<TabsPrimitive.Root
		defaultValue={defaultValue ?? items[0]?.value}
		value={value}
		onValueChange={onValueChange}
		className={cn(variantClasses[variant].root, className)}
	>
		<TabsPrimitive.List className={variantClasses[variant].list}>
			{items.map((item) => (
				<TabsPrimitive.Trigger key={item.value} value={item.value} className={variantClasses[variant].trigger}>
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
