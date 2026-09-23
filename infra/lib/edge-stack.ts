import { fileURLToPath } from 'node:url';
import { Annotations, Duration, Fn, Stack, type StackProps } from 'aws-cdk-lib';
import type * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { config } from '../config';
import { API_STATIC_CSP, HSTS_MAX_AGE_SECONDS, HTML_CSP, PERMISSIONS_POLICY } from './headers';

export interface EdgeStackProps extends StackProps {
  readonly certificate: acm.ICertificate;
  readonly webBucket: s3.IBucket;
  /** Wert für /nina-pm/web/build-id; `pnpm deploy:prod` setzt ihn per `-c buildId=<commit>`. */
  readonly buildId: string;
  /** HTTP API aus NinaPm-Api als Origin für /api/* (AP-02b). */
  readonly httpApi: apigw.IHttpApi;
}

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * NinaPm-Edge: eigene CloudFront-Distribution nina-pm.svenesis.org (TK 4.1, 4.3). Die Website-
 * Distribution wird weder referenziert noch verändert; in der Zone entstehen nur Einträge `nina-pm`.
 */
export class EdgeStack extends Stack {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    // Bucket nur über Attribute einbinden: die OAC-Bucket-Policy entsteht hier (siehe WebStack).
    const webBucket = s3.Bucket.fromBucketAttributes(this, 'WebBucket', {
      bucketArn: props.webBucket.bucketArn,
      bucketRegionalDomainName: props.webBucket.bucketRegionalDomainName,
    });
    const webOrigin = origins.S3BucketOrigin.withOriginAccessControl(webBucket);
    Annotations.of(this).acknowledgeWarning(
      '@aws-cdk/aws-cloudfront-origins:updateImportedBucketPolicyOac',
      'Bucket-Policy wird unten in diesem Stack explizit angelegt.',
    );

    const securityHeaders = (csp: string): cloudfront.ResponseSecurityHeadersBehavior => ({
      contentSecurityPolicy: { contentSecurityPolicy: csp, override: true },
      strictTransportSecurity: {
        accessControlMaxAge: Duration.seconds(HSTS_MAX_AGE_SECONDS),
        includeSubdomains: true,
        override: true,
      },
      contentTypeOptions: { override: true },
      referrerPolicy: {
        referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
        override: true,
      },
    });
    const commonCustomHeaders: cloudfront.ResponseCustomHeader[] = [
      { header: 'Permissions-Policy', value: PERMISSIONS_POLICY, override: true },
      { header: 'Cross-Origin-Opener-Policy', value: 'same-origin', override: true },
    ];

    const htmlHeaders = new cloudfront.ResponseHeadersPolicy(this, 'HtmlHeaders', {
      responseHeadersPolicyName: 'npm-html',
      comment: 'NINA-PM Anwendung (iam.md §10)',
      securityHeadersBehavior: securityHeaders(HTML_CSP),
      customHeadersBehavior: { customHeaders: commonCustomHeaders },
    });
    const apiStaticHeaders = new cloudfront.ResponseHeadersPolicy(this, 'ApiStaticHeaders', {
      responseHeadersPolicyName: 'npm-api-static',
      comment: 'NINA-PM /api, /catalog, /downloads (iam.md §10)',
      securityHeadersBehavior: securityHeaders(API_STATIC_CSP),
      customHeadersBehavior: {
        customHeaders: [
          ...commonCustomHeaders,
          { header: 'Cross-Origin-Resource-Policy', value: 'same-origin', override: true },
        ],
      },
    });

    const viewerRequest = new cloudfront.Function(this, 'ViewerRequest', {
      functionName: 'nina-pm-viewer-request',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromFile({
        filePath: fromHere('../edge/nina-pm-viewer-request.js'),
      }),
    });

    const staticBehavior: cloudfront.BehaviorOptions = {
      origin: webOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      responseHeadersPolicy: apiStaticHeaders,
      compress: true,
    };

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: config.domainName,
      domainNames: [config.domainName],
      certificate: props.certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: webOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: htmlHeaders,
        functionAssociations: [
          { function: viewerRequest, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
        compress: true,
      },
      additionalBehaviors: {
        // HTTP API mit dem einen Origin-Verify-Wert aus SSM (SV-16); die Lambda prüft ihn.
        '/api/*': {
          origin: new origins.HttpOrigin(Fn.select(2, Fn.split('/', props.httpApi.apiEndpoint)), {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            customHeaders: {
              'X-Origin-Verify': ssm.StringParameter.valueForStringParameter(
                this,
                config.ssm.originVerify,
              ),
            },
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: apiStaticHeaders,
          compress: true,
        },
        '/catalog/*': staticBehavior,
        '/downloads/*': staticBehavior,
      },
      // Keine distributionweiten Custom Error Responses (TK 4.3).
    });

    const webBucketPolicy = new s3.BucketPolicy(this, 'WebBucketPolicy', { bucket: webBucket });
    webBucketPolicy.document.addStatements(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontOacRead',
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [webBucket.arnForObjects('*')],
        conditions: {
          StringEquals: { 'AWS:SourceArn': this.distribution.distributionArn },
        },
      }),
      new iam.PolicyStatement({
        sid: 'DenyInsecureTransport',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:*'],
        resources: [webBucket.bucketArn, webBucket.arnForObjects('*')],
        conditions: { Bool: { 'aws:SecureTransport': 'false' } },
      }),
    );

    // Nur lesen (SV-19); Einträge ausschließlich unter nina-pm (Assertion 7).
    const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: config.zoneName });
    const aliasTarget = route53.RecordTarget.fromAlias(
      new targets.CloudFrontTarget(this.distribution),
    );
    new route53.ARecord(this, 'AliasA', {
      zone,
      recordName: config.recordName,
      target: aliasTarget,
    });
    new route53.AaaaRecord(this, 'AliasAaaa', {
      zone,
      recordName: config.recordName,
      target: aliasTarget,
    });

    new ssm.StringParameter(this, 'WebBuildId', {
      parameterName: config.ssm.webBuildId,
      stringValue: props.buildId,
      description: 'Aktueller Web-Build (schreibt der Deploy, DAT5-6)',
    });

    // Platzhalterseite bis zur SPA (AP-06a). prune: false – vorhandene Objekte bleiben (TK 4.1).
    new s3deploy.BucketDeployment(this, 'Placeholder', {
      sources: [s3deploy.Source.asset(fromHere('../placeholder'))],
      destinationBucket: webBucket,
      prune: false,
      cacheControl: [s3deploy.CacheControl.noCache()],
      distribution: this.distribution,
      distributionPaths: ['/index.html'],
      // 90 Tage für alle Log-Gruppen (SV-15), auch für die CDK-Hilfs-Lambda.
      logGroup: new logs.LogGroup(this, 'PlaceholderDeploymentLogs', {
        retention: logs.RetentionDays.THREE_MONTHS,
      }),
    });
  }
}
