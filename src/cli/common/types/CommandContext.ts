/** The dispatcher-built argument every command receives. */
export interface CommandContext {
	flags: Map<string, string | true>;
	rest: string[];
	cwd: string;
}
