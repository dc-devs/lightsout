import { buildIssueSummary } from './buildIssueSummary';

// The hook composes: it holds the wiring, and the arithmetic lives in a utility
// that can be tested without a renderer.
export const useIssueSummary = ({ issues }: { issues: Array<{ id: string; state: string; amount: number }> }) => buildIssueSummary({ issues });
