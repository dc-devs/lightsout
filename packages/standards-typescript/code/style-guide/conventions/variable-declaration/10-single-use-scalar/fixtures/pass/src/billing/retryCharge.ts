// Consumed in two places, which is exactly what earns module scope.
const maxAttempts = 3;

const isFinalAttempt = ({ attempt }: { attempt: number }) => attempt >= maxAttempts;

export const retryCharge = ({ attempt }: { attempt: number }): boolean => attempt < maxAttempts && !isFinalAttempt({ attempt });
