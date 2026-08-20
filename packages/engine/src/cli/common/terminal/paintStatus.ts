import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import { RunStatus } from '#src/contracts/index.ts';

interface Params {
	status: string;
	text: string;
}

export const paintStatus = ({ status, text }: Params): string => {
	if (status === RunStatus.Passed) {
		return green(text);
	}

	return status === RunStatus.Failed ? red(text) : yellow(text);
};
