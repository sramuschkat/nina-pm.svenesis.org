import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import type * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type * as sqs from 'aws-cdk-lib/aws-sqs';
import type * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { config } from '../config';
import { AppFunction } from './app-function';

export interface OpsStackProps extends StackProps {
  readonly dsqlClusterArn: string;
  readonly dsqlEndpointParam: ssm.IStringParameter;
  readonly failureQueue: sqs.IQueue;
  readonly api: lambda.IFunction;
  readonly apiLogGroup: logs.ILogGroup;
  readonly worker: lambda.IFunction;
  readonly httpApi: apigw.HttpApi;
}

const NAMESPACE = 'NinaPm';

/**
 * NinaPm-Ops: Lambda `ops-cli`, SNS-E-Mail-Topic, Alarme nach TK 16.2, Route-53-Health-Check auf
 * /api/health über CloudFront und Budget (TK 4.1, iam.md §5). Kein Alarm auf den Health-Check
 * (Entscheidung Sven, 23.09.2026: dessen Metriken liegen nur in us-east-1).
 */
export class OpsStack extends Stack {
  readonly opsCli: AppFunction;
  readonly topic: sns.Topic;
  readonly alarms: cw.Alarm[] = [];

  constructor(scope: Construct, id: string, props: OpsStackProps) {
    super(scope, id, props);

    // --- ops-cli: nur per `aws lambda invoke` mit Admin-Profil; keine Route, keine URL, keine Ressourcenpolitik.
    this.opsCli = new AppFunction(this, 'OpsCli', {
      ...config.lambdas.opsCli,
      handlerFile: 'ops-cli',
      memorySize: 256,
      timeout: Duration.seconds(60),
      dsqlClusterArn: props.dsqlClusterArn,
      environment: {
        DSQL_ENDPOINT_PARAM: config.ssm.dsqlEndpoint,
        FAILURE_QUEUE_URL: props.failureQueue.queueUrl,
      },
    });
    props.dsqlEndpointParam.grantRead(this.opsCli.fn);
    props.failureQueue.grantConsumeMessages(this.opsCli.fn);

    // --- SNS → E-Mail (H-09 bestätigt das Abo).
    this.topic = new sns.Topic(this, 'Alarms', { topicName: config.alarmTopic, enforceSSL: true });
    this.topic.addSubscription(new subs.EmailSubscription(config.alarmEmail));
    this.topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowBudgets',
        principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.topic.topicArn],
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    );
    const action = new cwActions.SnsAction(this.topic);
    const alarm = (
      idName: string,
      options: Omit<cw.AlarmProps, 'alarmName' | 'treatMissingData'>,
    ) => {
      const a = new cw.Alarm(this, idName, {
        alarmName: `nina-pm-${idName}`,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        ...options,
      });
      a.addAlarmAction(action);
      this.alarms.push(a);
      return a;
    };
    const five = Duration.minutes(5);

    // --- Alarme nach TK 16.2.
    const count = props.httpApi.metricCount({ period: five, statistic: 'Sum' });
    const serverErrors = props.httpApi.metricServerError({ period: five, statistic: 'Sum' });
    alarm('api-5xx-rate', {
      metric: new cw.MathExpression({
        expression: 'IF(requests > 0, 100 * errors / requests, 0)',
        usingMetrics: { requests: count, errors: serverErrors },
        period: five,
        label: 'API 5xx in %',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'API 5xx > 1 % in 5 min (TK 16.2)',
    });

    const ninaErrors = new logs.MetricFilter(this, 'ApiNinaErrorsFilter', {
      logGroup: props.apiLogGroup,
      metricNamespace: NAMESPACE,
      metricName: 'ApiNinaErrors',
      metricValue: '1',
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.stringValue('$.level', '=', 'ERROR'),
        logs.FilterPattern.stringValue('$.route', '=', '/api/nina/v1/*'),
      ),
    });
    alarm('api-nina-errors', {
      metric: ninaErrors.metric({ period: Duration.minutes(10), statistic: 'Sum' }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription:
        'Lambda-Fehler api auf /api/nina/v1 ≥ 3 in 10 min (TK 16.2, nachts kritisch)',
    });

    alarm('worker-errors', {
      metric: props.worker.metricErrors({ period: five, statistic: 'Sum' }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'worker-Fehler > 0 (TK 16.2)',
    });
    alarm('worker-failures-queue', {
      metric: props.failureQueue.metricApproximateNumberOfMessagesVisible({
        period: five,
        statistic: 'Maximum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Nachrichten in nina-pm-worker-failures > 0 (TK 16.2)',
    });

    // Anwendungsmetriken (Powertools Metrics setzen die Dimension `service`, TK 16.1); sie entstehen ab AP-05/AP-14b.
    alarm('stale-running-sessions', {
      metric: new cw.Metric({
        namespace: NAMESPACE,
        metricName: 'StaleRunningSessions',
        dimensionsMap: { service: config.lambdas.worker.functionName },
        period: five,
        statistic: 'Maximum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Laufende Session ohne Heartbeat > 10 min (TK 16.2, Pflicht)',
    });
    const retries = (service: string) =>
      new cw.Metric({
        namespace: NAMESPACE,
        metricName: 'DsqlRetries',
        dimensionsMap: { service },
        period: five,
        statistic: 'Sum',
      });
    alarm('dsql-retries', {
      metric: new cw.MathExpression({
        expression: 'FILL(api, 0) + FILL(worker, 0)',
        usingMetrics: {
          api: retries(config.lambdas.api.functionName),
          worker: retries(config.lambdas.worker.functionName),
        },
        period: five,
        label: 'DSQL-Wiederholungen',
      }),
      threshold: 20,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'DSQL-Wiederholungen > 20 in 5 min (TK 16.2)',
    });

    alarm('backup-jobs-failed', {
      metric: new cw.Metric({
        namespace: 'AWS/Backup',
        metricName: 'NumberOfBackupJobsFailed',
        dimensionsMap: { BackupVaultName: config.backup.vaultName },
        period: Duration.hours(1),
        statistic: 'Sum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'AWS Backup: NumberOfBackupJobsFailed > 0 (TK 16.2, SV-15)',
    });
    alarm('api-throttles', {
      metric: props.api.metricThrottles({ period: five, statistic: 'Sum' }),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription:
        'Throttles api > 10 in 5 min – reservierte Parallelität erschöpft (TK 16.2, SEC-15)',
    });
    alarm('api-stage-count', {
      metric: count,
      threshold: 100_000,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription:
        'Aufrufe der HTTP-API-Stage > 100.000 in 5 min (Missbrauch/Kosten, TK 16.2)',
    });
    // DSQL-Verbrauch (DPU): Schwelle erst nach 4 Wochen Betrieb (TK 16.2) – folgt dann.

    // --- Route-53-Health-Check auf /api/health über CloudFront (ohne Alarm, s. o.).
    new route53.HealthCheck(this, 'HealthCheck', {
      type: route53.HealthCheckType.HTTPS,
      fqdn: config.domainName,
      resourcePath: '/api/health',
      port: 443,
      failureThreshold: 3,
      requestInterval: Duration.seconds(30),
      regions: ['eu-west-1', 'us-east-1', 'ap-southeast-1'],
    });

    // --- Budget (TK 16.2).
    new budgets.CfnBudget(this, 'Budget', {
      budget: {
        budgetName: 'nina-pm-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: config.budgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: this.topic.topicArn }],
        },
      ],
    });
  }
}
