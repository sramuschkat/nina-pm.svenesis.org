import { ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it, vi } from 'vitest';
import { runOpsCommand, type SqsLike } from '../src/ops/commands';

const queueUrl = 'https://sqs.eu-central-1.amazonaws.com/1/nina-pm-worker-failures';

function fakeSqs(
  messages: { MessageId: string; Body: string; Attributes?: Record<string, string> }[] = [],
) {
  const send = vi.fn<SqsLike['send']>(() => Promise.resolve({ Messages: messages }));
  return { sqs: { send } as SqsLike, send };
}

describe('ops-cli', () => {
  it('help listet die Befehle', async () => {
    const res = await runOpsCommand(
      { command: 'help' },
      { ...fakeSqs(), failureQueueUrl: queueUrl },
    );
    expect(res.ok).toBe(true);
    expect(Object.keys(res.output as object)).toEqual(['help', 'list-failed-jobs']);
  });

  it('unbekannter Befehl liefert ok: false mit Übersicht', async () => {
    const res = await runOpsCommand(
      { command: 'drop-database' },
      { ...fakeSqs(), failureQueueUrl: queueUrl },
    );
    expect(res).toMatchObject({ ok: false, command: 'drop-database' });
  });

  it('list-failed-jobs sieht Nachrichten nur an (VisibilityTimeout 0)', async () => {
    const { sqs, send } = fakeSqs([
      {
        MessageId: 'm1',
        Body: '{"requestContext":{}}',
        Attributes: { SentTimestamp: '1790000000000' },
      },
    ]);
    const res = await runOpsCommand(
      { command: 'list-failed-jobs' },
      { sqs, failureQueueUrl: queueUrl },
    );
    expect(res.ok).toBe(true);
    expect(res.output).toMatchObject({
      count: 1,
      messages: [{ id: 'm1', sentAt: '2026-09-21T14:13:20.000Z' }],
    });
    const cmd = send.mock.calls[0]?.[0];
    expect(cmd).toBeInstanceOf(ReceiveMessageCommand);
    expect(cmd?.input).toMatchObject({
      QueueUrl: queueUrl,
      VisibilityTimeout: 0,
      MaxNumberOfMessages: 10,
    });
  });
});
