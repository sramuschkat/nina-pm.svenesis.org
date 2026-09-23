import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { config } from '../config';
import { AppFunction } from './app-function';

export interface JobsStackProps extends StackProps {
  readonly dsqlClusterArn: string;
  readonly dataBucket: s3.IBucket;
  readonly webBucket: s3.IBucket;
  readonly params: {
    readonly dsqlEndpoint: ssm.IStringParameter;
    readonly alarmWebhook: ssm.IStringParameter;
  };
  readonly webBuildIdParam: ssm.IStringParameter;
}

/** Die vier Zeitpläne in UTC (TK 13). */
export const SCHEDULES = [
  { name: 'tick-5min', expression: scheduler.ScheduleExpression.rate(Duration.minutes(5)) },
  { name: 'tick-hourly', expression: scheduler.ScheduleExpression.cron({ minute: '0' }) },
  { name: 'daily', expression: scheduler.ScheduleExpression.cron({ minute: '0', hour: '3' }) },
  {
    name: 'weekly',
    expression: scheduler.ScheduleExpression.cron({ minute: '30', hour: '4', weekDay: 'SUN' }),
  },
] as const;

/** NinaPm-Jobs: Lambda `worker`, Fehler-Queue, vier Zeitpläne (TK 4.1, 13, iam.md §3, §6). */
export class JobsStack extends Stack {
  readonly worker: AppFunction;
  readonly failureQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: JobsStackProps) {
    super(scope, id, props);

    this.failureQueue = new sqs.Queue(this, 'WorkerFailures', {
      queueName: config.workerFailureQueue,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });

    this.worker = new AppFunction(this, 'Worker', {
      ...config.lambdas.worker,
      handlerFile: 'worker',
      memorySize: 2048,
      timeout: Duration.minutes(15),
      reservedConcurrentExecutions: config.reservedConcurrency.worker,
      dsqlClusterArn: props.dsqlClusterArn,
      environment: {
        DSQL_ENDPOINT_PARAM: config.ssm.dsqlEndpoint,
        DSQL_DB_ROLE: 'app_job',
        WEB_BUILD_ID_PARAM: config.ssm.webBuildId,
        ALARM_WEBHOOK_PARAM: config.ssm.alarmWebhook,
        DATA_BUCKET: props.dataBucket.bucketName,
        WEB_BUCKET: props.webBucket.bucketName,
      },
    });
    const fn = this.worker.fn;

    // Asynchrone Aufrufe: keine Wiederholung, Fehler in die Queue (TK 13, 7.4).
    fn.configureAsyncInvoke({
      retryAttempts: 0,
      onFailure: new destinations.SqsDestination(this.failureQueue),
    });

    // Rechte genau nach iam.md §3.
    props.dataBucket.grantReadWrite(fn, 'tenant/*');
    props.webBucket.grantReadWrite(fn, 'catalog/thumbs/*');
    props.webBucket.grantRead(fn, 'assets/*');
    props.webBucket.grantDelete(fn, 'assets/*');
    props.params.dsqlEndpoint.grantRead(fn);
    props.webBuildIdParam.grantRead(fn);
    props.params.alarmWebhook.grantRead(fn);

    // Zeitpläne über das CDK-Ziel LambdaInvoke; die Aufrufrolle legt CDK selbst an (iam.md §6).
    const group = new scheduler.ScheduleGroup(this, 'ScheduleGroup', {
      scheduleGroupName: config.scheduleGroup,
    });
    for (const s of SCHEDULES) {
      new scheduler.Schedule(this, `Schedule-${s.name}`, {
        scheduleName: `nina-pm-${s.name}`,
        scheduleGroup: group,
        schedule: s.expression,
        target: new targets.LambdaInvoke(fn, {
          input: scheduler.ScheduleTargetInput.fromObject({ tick: s.name }),
        }),
        description: `worker {tick: ${s.name}} (TK 13)`,
      });
    }
  }
}
