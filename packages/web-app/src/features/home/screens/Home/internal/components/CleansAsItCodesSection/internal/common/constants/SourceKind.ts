/** Where in lightsout a benefit happens: a Standards Pack rule, a deterministic check on every run, or a step of planning. */
export const SourceKind = { StandardsPack: 'standards-pack', Planning: 'planning' } as const;

export type SourceKind = (typeof SourceKind)[keyof typeof SourceKind];
