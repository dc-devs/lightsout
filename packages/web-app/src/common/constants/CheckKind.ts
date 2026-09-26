/** The two ways a rule is enforced — the one vocabulary every page, filter and address uses for it. */
export const CheckKind = { Deterministic: 'deterministic', Agent: 'agent' } as const;

export type CheckKind = (typeof CheckKind)[keyof typeof CheckKind];
