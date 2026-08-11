import { getInstallStepLabel } from './common/utils/getInstallStepLabel';

interface Props {
	step: number;
}

// A folder here earns itself: the component owns a helper nobody else may use.
export const InstallPanel = ({ step }: Props) => <p>{getInstallStepLabel({ step })}</p>;
