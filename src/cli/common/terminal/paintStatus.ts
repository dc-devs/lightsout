import { RunStatus } from '@/contracts';
import { green } from '@/cli/common/terminal/green';
import { red } from '@/cli/common/terminal/red';
import { yellow } from '@/cli/common/terminal/yellow';

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
