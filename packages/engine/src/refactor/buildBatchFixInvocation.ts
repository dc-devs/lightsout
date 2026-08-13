import { buildRefactorExecutorInvocation, buildUnitTestWriterInvocation } from '@/agents';
import type { StandardsFinding } from '@/contracts';

interface Params {
	planContent: string;
	files: string[];
	standards?: string;
	testStandards?: string;
	findings: StandardsFinding[];
	advisories: StandardsFinding[];
	/** The red gate output handed to the fixing role. */
	gateError: string;
	/** Supervisor diagnosis + guidance sections, appended on the guided retry. */
	guidance?: string;
}

/**
 * Fix routing shared by the cheap-retry loop and the supervisor-guided
 * retry: coverage routes to the test writer only when coverage is the ONLY
 * red kind — mixed failures fix the source first (the coverage red may be
 * downstream of the source break).
 */
export const buildBatchFixInvocation = ({
	planContent,
	files,
	standards,
	testStandards,
	findings,
	advisories,
	gateError,
	guidance,
}: Params): { systemPrompt: string; prompt: string } => {
	const errorContext = guidance ? `${gateError}\n\n${guidance}` : gateError;
	const coverageRed = gateError.includes('test-coverage failed') && !/(check|test-unit|build|generate|format) failed/.test(gateError);

	// The executor branch also asks the agent to account for each advisory it was
	// shown: a batch persists that answer, and a fix retry is the same agent still
	// working the same advisory list.
	return coverageRed
		? buildUnitTestWriterInvocation({ planContent, subjects: files, mustExecute: files, standards: testStandards, errorContext })
		: buildRefactorExecutorInvocation({ planContent, changedFiles: files, standards, findings, advisories, reportAdvisoryOutcomes: true, errorContext });
};
