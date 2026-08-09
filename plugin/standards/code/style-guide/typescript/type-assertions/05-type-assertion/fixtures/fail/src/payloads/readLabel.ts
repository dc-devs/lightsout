// The payload's field is `unknown`, and the cast says it is a string rather
// than proving it — a value from outside now travels as a checked one.
export const readLabel = ({ payload }: { payload: Record<string, unknown> }): string => (payload.label as string).toUpperCase();
