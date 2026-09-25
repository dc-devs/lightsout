import { green } from '#src/cli/internal/common/terminal/green.ts';
import { red } from '#src/cli/internal/common/terminal/red.ts';
import { yellow } from '#src/cli/internal/common/terminal/yellow.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';

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
