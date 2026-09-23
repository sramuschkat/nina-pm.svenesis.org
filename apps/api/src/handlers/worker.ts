/** Lambda `worker`: Job-Dispatcher für Zeitpläne und Jobs (TK 13, 7.4). */
import { dispatch } from '../worker/dispatch';

export const handler = (event: unknown) => dispatch(event);
