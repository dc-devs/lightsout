// Narrowed rather than asserted, so the branch that returns a string is the
// branch the compiler proved.
export const readLabel = ({ payload }: { payload: Record<string, unknown> }): string => {
	const label = payload.label;

	return typeof label === 'string' ? label.toUpperCase() : '';
};
