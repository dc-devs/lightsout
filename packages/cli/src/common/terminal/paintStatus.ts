import { RunStatus } from '@lightsout/contracts';
import { green } from './green';
import { red } from './red';
import { yellow } from './yellow';

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
