import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { config } from '../config';
import { AppFunction } from './app-function';

export interface ApiStackProps extends StackProps {
  readonly dsqlClusterArn: string;
  readonly dataBucket: s3.IBucket;
  readonly worker: lambda.IFunction;
  readonly buildId: string;
  readonly params: {
    readonly cookieSecret: ssm.IStringParameter;
    readonly discordClientId: ssm.IStringParameter;
    readonly discordClientSecret: ssm.IStringParameter;
    readonly originVerify: ssm.IStringParameter;
    readonly bootstrapSuperUsers: ssm.IStringParameter;
    readonly dsqlEndpoint: ssm.IStringParameter;
  };
  readonly webBuildIdParam: ssm.IStringParameter;
}

/** Routen mit eigener Drosselung (iam.md §9); alles andere läuft über `ANY /api/{proxy+}`. */
export const THROTTLED_ROUTES = [
  { method: apigw.HttpMethod.GET, path: '/api/health', limit: config.throttle.sensitive },
  { method: apigw.HttpMethod.ANY, path: '/api/nina/v1/{proxy+}', limit: config.throttle.nina },
  {
    method: apigw.HttpMethod.GET,
    path: '/api/auth/discord/{proxy+}',
    limit: config.throttle.sensitive,
  },
  {
    method: apigw.HttpMethod.POST,
    path: '/api/auth/invitation/claim',
    limit: config.throttle.sensitive,
  },
  {
    method: apigw.HttpMethod.POST,
    path: '/api/auth/invitations/preview',
    limit: config.throttle.sensitive,
  },
] as const;

/** NinaPm-Api: HTTP API und Lambda `api` (TK 4.1, 4.2, iam.md §2, §9). */
export class ApiStack extends Stack {
  readonly api: AppFunction;
  readonly httpApi: apigw.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    this.api = new AppFunction(this, 'Api', {
      ...config.lambdas.api,
      handlerFile: 'api',
      // 1769 MB = ein ganzer vCPU (Node rechnet in einem Thread): Nachtwerte, Plan und Kaltstart ≈ 1,7× schneller
      // als mit 1024 MB (Messung `dso_search` 10.10.2026).
      memorySize: 1769,
      timeout: Duration.seconds(29),
      reservedConcurrentExecutions: config.reservedConcurrency.api,
      dsqlClusterArn: props.dsqlClusterArn,
      environment: {
        BUILD_ID: props.buildId,
        ORIGIN_VERIFY_PARAM: config.ssm.originVerify,
        // Anmeldung (TK 5.1–5.4): Namen der Parameter, Werte liest die Lambda zur Laufzeit aus SSM.
        COOKIE_SECRET_PARAM: config.ssm.cookieSecret,
        DISCORD_CLIENT_ID_PARAM: config.ssm.discordClientId,
        DISCORD_CLIENT_SECRET_PARAM: config.ssm.discordClientSecret,
        BOOTSTRAP_SUPER_USERS_PARAM: config.ssm.bootstrapSuperUsers,
        DSQL_ENDPOINT_PARAM: config.ssm.dsqlEndpoint,
        DSQL_DB_ROLE: 'app_rw',
        WORKER_FUNCTION_NAME: config.lambdas.worker.functionName,
        DATA_BUCKET: props.dataBucket.bucketName,
      },
    });
    const fn = this.api.fn;

    // Rechte genau nach iam.md §2.
    props.dataBucket.grantRead(fn, 'tenant/*');
    props.dataBucket.grantPut(fn, 'tenant/*');
    // Mandant löschen (FA-MAN-03): Dateien unter tenant/<id>/ entfernen.
    props.dataBucket.grantDelete(fn, 'tenant/*');
    props.worker.grantInvoke(fn);
    // Genau die sieben Parameter aus §2 – ausdrücklich, damit nie ein weiterer mitrutscht.
    const {
      cookieSecret,
      discordClientId,
      discordClientSecret,
      originVerify,
      bootstrapSuperUsers,
      dsqlEndpoint,
    } = props.params;
    for (const p of [
      cookieSecret,
      discordClientId,
      discordClientSecret,
      originVerify,
      bootstrapSuperUsers,
      dsqlEndpoint,
    ]) {
      p.grantRead(fn);
    }
    props.webBuildIdParam.grantRead(fn);

    this.httpApi = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'nina-pm',
      createDefaultStage: true,
    });
    const integration = new HttpLambdaIntegration('ApiIntegration', fn);
    const routes = [
      ...this.httpApi.addRoutes({
        path: '/api/{proxy+}',
        methods: [apigw.HttpMethod.ANY],
        integration,
      }),
      ...THROTTLED_ROUTES.flatMap((r) =>
        this.httpApi.addRoutes({ path: r.path, methods: [r.method], integration }),
      ),
    ];

    const accessLogs = new logs.LogGroup(this, 'AccessLogs', {
      logGroupName: '/aws/apigateway/nina-pm-http-api',
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const stage = this.httpApi.defaultStage?.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: config.throttle.stage.rate,
      throttlingBurstLimit: config.throttle.stage.burst,
    };
    // routeSettings ist in CDK untypisiert und geht unverändert ins Template: Schlüssel wie in CloudFormation.
    stage.routeSettings = Object.fromEntries(
      THROTTLED_ROUTES.map((r) => [
        `${r.method} ${r.path}`,
        { ThrottlingRateLimit: r.limit.rate, ThrottlingBurstLimit: r.limit.burst },
      ]),
    );
    // Zugriffsprotokoll ohne IP: API Gateway kann sie nicht kürzen, und sie wird nicht gebraucht (TK 16.1).
    stage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        requestTime: '$context.requestTimeEpoch',
        routeKey: '$context.routeKey',
        status: '$context.status',
        integrationLatency: '$context.integrationLatency',
        responseLength: '$context.responseLength',
      }),
    };
    // Routen-Einstellungen verweisen auf Routen-Schlüssel; die Routen müssen vorher existieren.
    for (const route of routes) stage.node.addDependency(route);

    new CfnOutput(this, 'ApiEndpoint', { value: this.httpApi.apiEndpoint });
  }
}
