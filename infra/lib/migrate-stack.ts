import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import type * as ssm from 'aws-cdk-lib/aws-ssm';
import * as triggers from 'aws-cdk-lib/triggers';
import type { Construct } from 'constructs';
import { prodIamGrants } from '@nina-pm/db/migrate';
import { config } from '../config';
import { AppFunction } from './app-function';

export interface MigrateStackProps extends StackProps {
  readonly dsqlClusterArn: string;
  readonly dsqlEndpointParam: ssm.IStringParameter;
}

/**
 * NinaPm-Migrate (TK 4.1, 6.8, iam.md §4): Lambda `migrate` mit Rolle `NinaPmMigrate`
 * (`dsql:DbConnectAdmin` auf den Cluster-ARN) als CDK-Trigger. Er läuft, sobald sich der Handler –
 * und damit der Stand der eingebundenen Migrationen – ändert, und vor NinaPm-Api und NinaPm-Jobs.
 */
export class MigrateStack extends Stack {
  readonly migrate: AppFunction;

  constructor(scope: Construct, id: string, props: MigrateStackProps) {
    super(scope, id, props);
    this.migrate = new AppFunction(this, 'Migrate', {
      ...config.lambdas.migrate,
      handlerFile: 'migrate',
      memorySize: 512,
      timeout: Duration.minutes(15),
      dsqlClusterArn: props.dsqlClusterArn,
      dsqlAction: 'dsql:DbConnectAdmin',
      environment: {
        DSQL_ENDPOINT_PARAM: config.ssm.dsqlEndpoint,
        MIGRATE_IAM_GRANTS: JSON.stringify(prodIamGrants(config.account)),
      },
    });
    props.dsqlEndpointParam.grantRead(this.migrate.fn);

    new triggers.Trigger(this, 'RunMigrations', {
      handler: this.migrate.fn,
      timeout: Duration.minutes(15),
      executeOnHandlerChange: true,
    });
  }
}
