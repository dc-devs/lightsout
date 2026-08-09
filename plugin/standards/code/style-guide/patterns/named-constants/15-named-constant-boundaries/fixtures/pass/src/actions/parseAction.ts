import { Action } from '../common/constants/Action';

// The boundary is where the string becomes the union, and a validation function
// is what makes that true.
export const parseAction = ({ value }: { value: string }): Action | undefined =>
	Object.values(Action).find((member) => member === value);
