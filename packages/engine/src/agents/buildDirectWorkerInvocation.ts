import directWorkerPrompt from '#src/agents/prompts/directWorker.md';
import type { AnsweredQuestion } from '#src/common/types/AnsweredQuestion.ts';

interface Params {
	/** The ticket's human reference, e.g. 'LO-70'. */
	ticketRef: string;
	/** The ticket body, inlined verbatim — the agent never fetches its own context. */
	ticketBody: string;
	/** Optional consumer standards content, inlined verbatim. */
	standards?: string;
	/** Consumer-granted command prefixes (config `agent-commands`). */
	allowedCommands?: string[];
	/** Verification-gate output from a failed attempt, for fix re-invocations. */
	errorContext?: string;
	/** Files already changed earlier in the run — orients fix re-invocations. */
	changedFiles?: string[];
	/** The answer to a question this worker asked, folded back in on re-invocation. */
	answeredQuestion?: AnsweredQuestion;
}

/**
 * Assemble the direct worker's invocation deterministically.
 *
 * Everything stable across the run — the role prompt, the ticket, the
 * standards, the granted commands — rides the system prompt the harness caches
 * through, so a fix re-invocation pays only for what actually changed: the
 * changed-file list, the gate output, and an answered question.
 */
export const buildDirectWorkerInvocation = ({
	ticketRef,
	ticketBody,
	standards,
	allowedCommands,
	errorContext,
	changedFiles,
	answeredQuestion,
}: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [directWorkerPrompt, `# Ticket ${ticketRef}\n\n${ticketBody}`];

	if (standards) {
		roleSections.push(`# Standards\n\nThese rules are binding for every line you write:\n\n${standards}`);
	}

	if (allowedCommands && allowedCommands.length > 0) {
		roleSections.push(
			`# Granted commands\n\nYou may run these shell commands — and only these (prefix match; arguments after the prefix are allowed). Use them solely to produce what the ticket asks for and only a command can produce. Never use them to verify, install, or explore — the engine runs all gates itself. List every file a granted command creates in \`changedFiles\`.\n\n${allowedCommands.map((command) => `- \`${command}\``).join('\n')}`,
		);
	}

	const sections: string[] = [];

	if (answeredQuestion) {
		sections.push(
			`# Your question, answered\n\nYou stopped and asked this. The tree already holds the work you had done when you asked — continue it in place rather than starting over.\n\nQuestion: ${answeredQuestion.question}\n\nAnswer: ${answeredQuestion.answer}`,
		);
	}

	if (changedFiles && changedFiles.length > 0) {
		sections.push(
			`# Previously changed files\n\nFiles already created or modified earlier in this run:\n\n${changedFiles.map((file) => `- ${file}`).join('\n')}`,
		);
	}

	if (errorContext) {
		sections.push(
			`# Verification failure\n\nA previous attempt built this ticket, but the engine's verification gate failed. Diagnose from the output below, fix the root cause in source, and report as usual — your report must reflect the cumulative set of changed files.\n\n${errorContext}`,
		);
	}

	sections.push('Remember: your entire final message must be exactly one JSON report object — nothing else.');

	return { systemPrompt: roleSections.join('\n\n---\n\n'), prompt: sections.join('\n\n') };
};
