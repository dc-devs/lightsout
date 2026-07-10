export const VerifyVerdict = {
	Clean: 'clean',
	Red: 'red',
} as const;

export type VerifyVerdict = (typeof VerifyVerdict)[keyof typeof VerifyVerdict];
