/** What a marketing section's background wash is drawn with: wide ruled lines, or a fine square grid. */
export const GridPattern = { Lines: 'lines', Squares: 'squares' } as const;

export type GridPattern = (typeof GridPattern)[keyof typeof GridPattern];
