/** Which edge a table column's contents sit against — numbers read right, words read left. */
export const TableAlignment = {
	Left: 'left',
	Center: 'center',
	Right: 'right',
} as const;

export type TableAlignment = (typeof TableAlignment)[keyof typeof TableAlignment];

// Spelled out rather than interpolated, because Tailwind only emits classes it
// can read in the source.
export const tableAlignmentClasses: Record<TableAlignment, string> = {
	[TableAlignment.Left]: 'text-left',
	[TableAlignment.Center]: 'text-center',
	[TableAlignment.Right]: 'text-right',
};
