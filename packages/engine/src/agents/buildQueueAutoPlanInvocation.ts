import queueAutoPlanPrompt from '#src/agents/prompts/queueAutoPlan.md';
import type { AnsweredQuestion } from '#src/common/types/AnsweredQuestion.ts';

interface Params {
	ticketRef: string;
	ticketTitle: string;
	/** The ticket body, inlined verbatim. */
	ticketBody: string;
	/** How to invoke the engine from inside the session — the exact granted prefix, e.g. `node /path/to/cli.mjs`. */
	engineCli: string;
	/** The answer to a question this worker asked, folded back in on re-invocation. */
	answeredQuestion?: AnsweredQuestion;
}

/**
 * Assemble the headless auto-plan worker's invocation.
 *
 * The engine does not re-implement the auto-plan conductor: the prompt sends
 * the session to the skill and constrains only the parts the queue owns — no
 * interactive questions, one report as the final message, and never a ship.
 *
 * `engineCli` is stated in the prompt verbatim because it is also the command
 * prefix the session is granted. An instruction the grant does not cover fails
 * only at run time, in a headless session nobody is watching.
 */
export const buildQueueAutoPlanInvocation = ({
	ticketRef,
	ticketTitle,
	ticketBody,
	engineCli,
	answeredQuestion,
}: Params): { systemPrompt: string; prompt: string } => {
	const systemPrompt = [queueAutoPlanPrompt, `# Ticket ${ticketRef}: ${ticketTitle}\n\n${ticketBody}`].join('\n\n---\n\n');
	const sections = [`# The engine invocation\n\nRun every engine subcommand as:\n\n\`${engineCli} <subcommand>\`\n\nNothing else is granted to this session.`];

	if (answeredQuestion) {
		sections.push(
			`# Your question, answered\n\nYou stopped and asked this. The worktree already holds whatever you had done when you asked — continue from there rather than starting over.\n\nQuestion: ${answeredQuestion.question}\n\nAnswer: ${answeredQuestion.answer}`,
		);
	}

	sections.push('Remember: your entire final message must be exactly one JSON report object — nothing else.');

	return { systemPrompt, prompt: sections.join('\n\n') };
};
