/** Returns number1 divided by number2, or null when number2 is 0. */
export const divide = ({ number1, number2 }) => {
	if (number2 === 0) {
		return null;
	}
	return number1 / number2;
};
