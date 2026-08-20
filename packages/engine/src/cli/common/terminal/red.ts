import { paint } from '#src/cli/common/terminal/paint.ts';

export const red: (text: string) => string = paint({ code: '31' });
