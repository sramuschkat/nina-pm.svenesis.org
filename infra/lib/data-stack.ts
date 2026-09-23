import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as dsql from 'aws-cdk-lib/aws-dsql';
import * as events from 'aws-cdk-lib/aws-events';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { config } from '../config';

export interface DataStackProps extends StackProps {
  /**
   * Import-Modus (TK 4.1, DAT5-16): mit `-c dsqlClusterId=…` übernimmt der Stack einen vorhandenen
   * Cluster (z. B. nach einem Restore), statt einen neuen anzulegen.
   */
  readonly importClusterId?: string;
}

/** NinaPm-Data: DSQL-Cluster, Daten-Bucket, AWS-Backup-Plan (TK 4.1). */
export class DataStack extends Stack {
  readonly dataBucket: s3.Bucket;
  readonly clusterArn: string;
  readonly clusterEndpoint: string;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    this.dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: config.buckets.data,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    if (props.importClusterId) {
      const clusterId = props.importClusterId;
      this.clusterArn = this.formatArn({
        service: 'dsql',
        resource: 'cluster',
        resourceName: clusterId,
      });
      this.clusterEndpoint = `${clusterId}.dsql.${this.region}.on.aws`;
    } else {
      const cluster = new dsql.CfnCluster(this, 'Cluster', {
        deletionProtectionEnabled: true,
        tags: [{ key: 'purpose', value: 'prod' }],
      });
      cluster.applyRemovalPolicy(RemovalPolicy.RETAIN);
      this.clusterArn = cluster.attrResourceArn;
      this.clusterEndpoint = cluster.attrEndpoint;
    }

    const plan = new backup.BackupPlan(this, 'BackupPlan', {
      backupPlanName: 'nina-pm-dsql',
      backupVault: backup.BackupVault.fromBackupVaultName(
        this,
        'DefaultVault',
        config.backup.vaultName,
      ),
      backupPlanRules: [
        new backup.BackupPlanRule({
          ruleName: 'daily',
          scheduleExpression: events.Schedule.cron({ minute: '0', hour: '3' }),
          deleteAfter: Duration.days(config.backup.retentionDays),
        }),
      ],
    });
    plan.addSelection('Cluster', {
      backupSelectionName: 'nina-pm-dsql-cluster',
      resources: [backup.BackupResource.fromArn(this.clusterArn)],
    });

    // Den Parameter /nina-pm/dsql-endpoint legt Sven aus dieser Ausgabe an (H-05, iam.md §8).
    new CfnOutput(this, 'DsqlEndpoint', { value: this.clusterEndpoint });
    new CfnOutput(this, 'DsqlClusterArn', { value: this.clusterArn });
  }
}
