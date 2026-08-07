interface Params {
	code: string;
}

// ANSI paint, no-op when output is piped — alignment is computed on plain
// text first, so color codes never disturb the table geometry. The returned
// value is an emphasis callback whose (text) => string shape is a contract.
export const paint =
	({ code }: Params): ((text: string) => string) =>
	(text: string) =>
		process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text;
