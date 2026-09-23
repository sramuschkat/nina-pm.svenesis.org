import { Logger } from '@aws-lambda-powertools/logger';

/** Powertools Logger (JSON, TK 16.1). Dienstname je Lambda über POWERTOOLS_SERVICE_NAME. */
export const logger = new Logger();
