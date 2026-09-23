import { CfnWaitConditionHandle, Stack, type StackProps } from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { config } from '../config';

/**
 * NinaPm-Config: Referenzen auf die SSM-Parameter (TK 4.1, iam.md §8). Angelegt werden die Werte
 * einmalig von Sven per AWS CLI (H-05); SecureStrings mit dem Standardschlüssel alias/aws/ssm.
 * Der Stack legt selbst keine Parameter an, die Folgestacks erhalten hier die Referenzen.
 */
export class ConfigStack extends Stack {
  readonly params: {
    readonly cookieSecret: ssm.IStringParameter;
    readonly discordClientId: ssm.IStringParameter;
    readonly discordClientSecret: ssm.IStringParameter;
    readonly originVerify: ssm.IStringParameter;
    readonly bootstrapSuperUsers: ssm.IStringParameter;
    readonly dsqlEndpoint: ssm.IStringParameter;
    readonly alarmWebhook: ssm.IStringParameter;
  };

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    // CloudFormation lehnt Stacks ohne Ressource ab. Die Referenzen unten erzeugen keine; dieser
    // kostenlose Platzhalter hält den Stack gültig, auch ohne CDK-Metadaten.
    new CfnWaitConditionHandle(this, 'Placeholder');
    const secure = (cid: string, parameterName: string) =>
      ssm.StringParameter.fromSecureStringParameterAttributes(this, cid, { parameterName });
    // forceDynamicReference: keine CloudFormation-Parameter im Template. Sonst scheitert jeder
    // Deploy, solange ein Parameter aus H-05 noch fehlt (/nina-pm/dsql-endpoint entsteht erst nach AP-02a).
    const plain = (cid: string, parameterName: string) =>
      ssm.StringParameter.fromStringParameterAttributes(this, cid, {
        parameterName,
        forceDynamicReference: true,
      });

    this.params = {
      cookieSecret: secure('CookieSecret', config.ssm.cookieSecret),
      discordClientId: plain('DiscordClientId', config.ssm.discordClientId),
      discordClientSecret: secure('DiscordClientSecret', config.ssm.discordClientSecret),
      originVerify: plain('OriginVerify', config.ssm.originVerify),
      bootstrapSuperUsers: plain('BootstrapSuperUsers', config.ssm.bootstrapSuperUsers),
      dsqlEndpoint: plain('DsqlEndpoint', config.ssm.dsqlEndpoint),
      alarmWebhook: secure('AlarmWebhook', config.ssm.alarmWebhook),
    };
  }
}
