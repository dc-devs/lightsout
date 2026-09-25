import { paint } from '#src/cli/internal/common/terminal/paint.ts';

export const bold: (text: string) => string = paint({ code: '1' });
