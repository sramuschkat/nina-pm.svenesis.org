import { fileURLToPath } from 'node:url';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface AppFunctionProps {
  readonly functionName: string;
  /** Fester Rollenname (iam.md §1). */
  readonly roleName: string;
  /** Datei unter apps/api/src/handlers/ ohne Endung. */
  readonly handlerFile: 'api' | 'worker' | 'ops-cli' | 'migrate';
  readonly memorySize: number;
  readonly timeout: Duration;
  readonly reservedConcurrentExecutions?: number;
  readonly environment?: Record<string, string>;
  /** DSQL-Cluster-ARN für `dsql:DbConnect` (PolicyStatement, DSQL hat keinen Grant). */
  readonly dsqlClusterArn: string;
  /** Nur `migrate` verbindet als admin (iam.md §4, Assertion 4). */
  readonly dsqlAction?: 'dsql:DbConnect' | 'dsql:DbConnectAdmin';
}

/**
 * Lambda einer Anwendung (TK 4.2): arm64, Node 24, ESM-Bundle aus apps/api, X-Ray aktiv,
 * eigene Log-Gruppe mit 90 Tagen, eigene Rolle mit festem Namen und nur
 * `AWSLambdaBasicExecutionRole` als Managed Policy (SV-13, iam.md §1). Weitere Rechte vergibt
 * der jeweilige Stack über Grants.
 */
export class AppFunction extends Construct {
  readonly fn: nodejs.NodejsFunction;
  readonly role: iam.Role;
  readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: AppFunctionProps) {
    super(scope, id);
    this.role = new iam.Role(this, 'Role', {
      roleName: props.roleName,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: [props.dsqlAction ?? 'dsql:DbConnect'],
        resources: [props.dsqlClusterArn],
      }),
    );
    this.logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: `/aws/lambda/${props.functionName}`,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.fn = new nodejs.NodejsFunction(this, 'Function', {
      functionName: props.functionName,
      entry: `${repoRoot}apps/api/src/handlers/${props.handlerFile}.ts`,
      handler: 'handler',
      projectRoot: repoRoot,
      depsLockFilePath: `${repoRoot}pnpm-lock.yaml`,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: props.memorySize,
      timeout: props.timeout,
      role: this.role,
      logGroup: this.logGroup,
      tracing: lambda.Tracing.ACTIVE,
      ...(props.reservedConcurrentExecutions === undefined
        ? {}
        : { reservedConcurrentExecutions: props.reservedConcurrentExecutions }),
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        POWERTOOLS_SERVICE_NAME: props.functionName,
        POWERTOOLS_LOG_LEVEL: 'INFO',
        ...props.environment,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: 'node24',
        minify: true,
        sourceMap: true,
        sourcesContent: false,
        mainFields: ['module', 'main'],
        // @aws-sdk/* liefert die Lambda-Laufzeit mit.
        externalModules: ['@aws-sdk/*'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        // Migrationen liegen als Text im Bundle von `migrate` (packages/db/src/migrate/bundled.ts).
        loader: { '.sql': 'text' },
      },
    });
  }
}
