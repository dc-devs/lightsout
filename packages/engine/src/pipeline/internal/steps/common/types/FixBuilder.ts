/**
 * Builds the agent invocation that repairs a red verification checkpoint, given
 * what went red. The builder steps choose which role repairs a checkpoint, and
 * the checkpoint only calls what it is given.
 */
export type FixBuilder = ({ errorContext }: { errorContext: string }) => { systemPrompt: string; prompt: string };
