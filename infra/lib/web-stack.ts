import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { config } from '../config';

/**
 * NinaPm-Web: Bucket für SPA (`/`), Katalog (`/catalog/`) und Downloads (`/downloads/`), TK 4.1.
 * Die Bucket-Policy (Lesen nur über CloudFront mit OAC, nur TLS) liegt im Edge-Stack, weil sie die
 * Distribution referenziert; sonst entstünde eine zyklische Abhängigkeit zwischen Web und Edge.
 */
export class WebStack extends Stack {
  readonly webBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    this.webBucket = new s3.Bucket(this, 'WebBucket', {
      bucketName: config.buckets.web,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
