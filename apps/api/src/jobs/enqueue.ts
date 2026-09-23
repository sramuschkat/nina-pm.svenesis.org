/**
 * Jobs anlegen (TK 7.4): Zeile in `job` (Dedupe, Grenze je Mitglied im Repository), dann `worker`
 * **asynchron nur mit `{jobId}`** aufrufen. Scheitert der Aufruf, bleibt der Job `pending` und
 * `tick-5min` übernimmt ihn nach 2 min – deshalb wird der Fehler nur geloggt.
 */
import { InvokeCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import type { EnqueueInput, EnqueueResult } from '@nina-pm/db';
import { logger } from '../lib/logger';

export interface JobInvoker {
  invoke(jobId: string): Promise<void>;
}

export interface JobEnqueuer {
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;
}

export function lambdaJobInvoker(client: LambdaClient, functionName: string): JobInvoker {
  return {
    async invoke(jobId) {
      await client.send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: 'Event',
          Payload: new TextEncoder().encode(JSON.stringify({ jobId })),
        }),
      );
    },
  };
}

export async function enqueueJob(
  repo: JobEnqueuer,
  invoker: JobInvoker,
  input: EnqueueInput,
): Promise<EnqueueResult> {
  const result = await repo.enqueue(input);
  if (result.created) {
    try {
      await invoker.invoke(result.jobId);
    } catch (error) {
      logger.warn('job_invoke_failed', { jobId: result.jobId, kind: input.kind, error });
    }
  }
  return result;
}
