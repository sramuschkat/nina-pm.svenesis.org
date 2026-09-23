/** Lambda `ops-cli`: Betriebskommandos, nur per `aws lambda invoke` mit Admin-Profil (TK 5.4). */
import { SQSClient } from '@aws-sdk/client-sqs';
import { logger } from '../lib/logger';
import { requiredEnv } from '../lib/params';
import { runOpsCommand } from '../ops/commands';

const sqs = new SQSClient({});

export async function handler(event: unknown) {
  const result = await runOpsCommand(event, {
    sqs,
    failureQueueUrl: requiredEnv('FAILURE_QUEUE_URL'),
  });
  logger.info('ops_cli_command', { command: result.command, ok: result.ok });
  return result;
}
