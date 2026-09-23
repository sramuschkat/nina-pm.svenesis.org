import { Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';
import { config } from '../config';

/** NinaPm-Cert (us-east-1): ACM-Zertifikat für CloudFront, DNS-Validierung über svenesis.org (TK 4.1). */
export class CertStack extends Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    // Nur lesen (SV-19); Lookup-Werte aus der eingecheckten cdk.context.json.
    const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: config.zoneName });
    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: config.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });
  }
}
