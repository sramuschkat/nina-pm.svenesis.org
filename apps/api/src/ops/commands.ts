/**
 * Befehle der Lambda `ops-cli` (TK 5.4, iam.md §5). Aufruf nur per `aws lambda invoke` mit Svens
 * Admin-Profil; keine Route, keine Function-URL. Stand AP-02b: `help`, `list-failed-jobs`.
 * Die Zeile in `system_audit` je Befehl (SV-11) folgt, sobald die Datenbank steht (AP-03/AP-04b).
 */
import { ReceiveMessageCommand } from '@aws-sdk/client-sqs';

export interface SqsLike {
  send(command: ReceiveMessageCommand): Promise<{
    Messages?: { MessageId?: string; Body?: string; Attributes?: Record<string, string> }[];
  }>;
}

export interface OpsDeps {
  readonly sqs: SqsLike;
  readonly failureQueueUrl: string;
}

export interface OpsResult {
  readonly ok: boolean;
  readonly command: string;
  readonly output: unknown;
}

const HELP = {
  help: 'Diese Übersicht.',
  'list-failed-jobs':
    'Zeigt bis zu 10 Nachrichten aus nina-pm-worker-failures, ohne sie zu löschen.',
} as const;

type Command = keyof typeof HELP;

export async function runOpsCommand(event: unknown, deps: OpsDeps): Promise<OpsResult> {
  const command =
    typeof event === 'object' && event !== null
      ? (event as { command?: unknown }).command
      : undefined;
  if (typeof command !== 'string' || !(command in HELP)) {
    return {
      ok: false,
      command: typeof command === 'string' ? command : '',
      output: { error: 'Unbekannter Befehl', commands: HELP },
    };
  }
  switch (command as Command) {
    case 'help':
      return { ok: true, command, output: HELP };
    case 'list-failed-jobs': {
      // VisibilityTimeout 0: nur ansehen, die Nachrichten bleiben sofort wieder sichtbar.
      const res = await deps.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: deps.failureQueueUrl,
          MaxNumberOfMessages: 10,
          VisibilityTimeout: 0,
          WaitTimeSeconds: 0,
          MessageSystemAttributeNames: ['SentTimestamp'],
        }),
      );
      const messages = (res.Messages ?? []).map((m) => ({
        id: m.MessageId,
        sentAt: m.Attributes?.SentTimestamp
          ? new Date(Number(m.Attributes.SentTimestamp)).toISOString()
          : undefined,
        body: m.Body && m.Body.length > 2000 ? `${m.Body.slice(0, 2000)} …` : m.Body,
      }));
      return { ok: true, command, output: { count: messages.length, messages } };
    }
  }
}
