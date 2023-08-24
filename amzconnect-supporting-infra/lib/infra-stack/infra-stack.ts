import {
  Stack,
  StackProps,
  CfnOutput,
  CfnParameter,
  RemovalPolicy,
  Fn
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { aws_ssm as  ssm } from 'aws-cdk-lib';
import { aws_s3 as s3 } from "aws-cdk-lib";
import { aws_iam as iam}  from 'aws-cdk-lib';
import { ConstructFactory } from '../common/construct-factory';
import { NagSuppressions } from 'cdk-nag'


export type InfraStackProps = StackProps

export class InfraStack extends Stack {
  constructor(scope: Construct, id: string, props: InfraStackProps) {
    super(scope, id, props);

    NagSuppressions.addStackSuppressions(this, [
        {
            id: 'AwsSolutions-IAM4',
            reason: 'This role is created by CDK and is only for cloudwatch logging.'
        },
        {
            id: 'AwsSolutions-IAM5',
            reason: 'This suppresses a cdk construct permission and another where the resource is indeterminate.'
        },
        {
            id: 'AwsSolutions-LEX4',
            reason: 'Encrypting conversation logs unnecessary for workshop.'
        }
    ])

    //* Get Connect Instance ID from SSM
    ssm.StringParameter.valueForStringParameter(this, 'AmazonConnectInstanceId')

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const env : string = (process.env.ENVIRONMENT! || "dev")
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const app : string = (process.env.APP! || "ACME")
    // const account : string = process.env.ACCOUNT!
    // const branch : string = process.env.BRANCH!
    const region = new CfnParameter(this, "deployRegion", {
        type: "String",
        description: "The region for the deployment."
    });

    //* Create S3 Bucket for callflows.

    //! Change bucket retention policy back to RETAIN. During developmnent want DESTROY

    const BucketProps  = {
      bucketName: Fn.join('-', ['callflow', 'bucket', env, region.valueAsString, Date.now() as unknown as string]),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.DESTROY
    };


    const s3Bucket = new s3.Bucket(
      this,
      `callflow-bucket-${env}`,
      BucketProps
    );
    NagSuppressions.addResourceSuppressions(s3Bucket, [
        {
            id: 'AwsSolutions-S1',
            reason: 'This bucket is used for contact flows and access logging is not necessary for this workshop.',
        },
    ]);

    // * Instantiate a new instance of the construct factory to create common infrastructure

    const factory = new ConstructFactory(this, "infra-stack");

    // *** Naming for various Lex related Infrastructure

    // * Lex Bot
    const botName = `${app}_lexbot`;

    // * Log Group
    const myLG = botName.concat("-", env, "-", "LogGroup");
    const logGroup = factory.createLexLogGroup(myLG);

    // * IAM role for lex bot
    const roleName = botName.concat("-", env)
    const lexRole = factory.createLexRole(roleName, region);

    // * Lex Policy

    const lexPolicy = new iam.Policy(this, "lexPolicy", {
      statements: [
        new iam.PolicyStatement({
          sid: "lexPolicies",
          actions: ["polly:SynthesizeSpeech", "comprehend:DetectSentiment"],
          resources: ["*"],
        }),
        new iam.PolicyStatement({
          sid: "loggingPolicies",
          actions: [
            "logs:PutLogEvents",
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
          ],
          resources: [logGroup.logGroupArn],
        }),
      ],
    });

    lexRole.attachInlinePolicy(lexPolicy);

    const lexBot = factory.createLexBot(botName, lexRole.roleArn);

    // * Create Lex Version
    const versionDescription = "initial version";
    const lexBotVersion = factory.createLexVersion(
      botName,
      lexBot.attrId,
      versionDescription
    );

    // * Create Lex Alias
    const lexBotAlias = factory.createLexAlias(
      botName,
      lexBot.attrId,
      lexBotVersion.attrBotVersion,
      env,
      logGroup.logGroupArn
    );

    // * SSM Parameters 

    factory.createStringSsmParam(
        `ssmCallflowBucketName`,
        `/${app}/${env}/ssmCallflowBucketName`,
        s3Bucket.bucketName
    )

    factory.createStringSsmParam(
        `ssmLexBotArn`,
        `/${app}/${env}/ssmLexBotArn`,
        lexBotAlias.attrArn
    )

    // * Outputs

    new CfnOutput(this, `${this.stackName}-Bucket`, {
      value: s3Bucket.bucketName,
    });

    new CfnOutput(this, `${this.stackName}-LexBot`, {
      value: lexBotAlias.attrArn,
    });

  }
}
