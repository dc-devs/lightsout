// `as const` is not the assertion this rule bans — it freezes literals, and the
// named-constants document asks for it by name.
export const PayloadKind = {
	Label: 'label',
	Amount: 'amount',
} as const;

export type PayloadKind = (typeof PayloadKind)[keyof typeof PayloadKind];
