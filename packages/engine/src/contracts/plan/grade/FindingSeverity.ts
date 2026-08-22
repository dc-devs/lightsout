/**
 * Whether a structural finding blocks a plan or only informs the human reading
 * it. Blocking findings gate `plan lint`'s exit code, the draft repair loop and
 * the grade verdict; advisory ones print beside them and gate nothing.
 */
export const FindingSeverity = {
	Blocking: 'blocking',
	Advisory: 'advisory',
} as const;

export type FindingSeverity = (typeof FindingSeverity)[keyof typeof FindingSeverity];
