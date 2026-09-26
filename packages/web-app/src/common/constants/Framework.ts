/** The frameworks the default pack ships rules for — TypeScript for every repo, the rest when a repo uses them. */
export const Framework = { TypeScript: 'typescript', React: 'react', TanStack: 'tanstack' } as const;

export type Framework = (typeof Framework)[keyof typeof Framework];
