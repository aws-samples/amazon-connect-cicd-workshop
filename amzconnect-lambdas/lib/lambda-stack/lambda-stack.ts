/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  Stack,
  StackProps,
  CfnOutput,
  CfnParameter,
  Duration,
} from "aws-cdk-lib";
import { aws_iam as iam } from "aws-cdk-lib";
import { aws_ssm as ssm } from "aws-cdk-lib";
import { aws_s3 as s3 } from "aws-cdk-lib";
import { Construct } from "constructs";
import { ConstructFactory } from "../common/construct-factory";
import { Tracing } from "aws-cdk-lib/aws-lambda";
import { NagSuppressions } from "cdk-nag";

export type LambdaStackProps = StackProps;

export class LambdaStack extends Stack {
  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    //  CDK Nag Suppressions

    NagSuppressions.addStackSuppressions(this, [
      {
        id: "AwsSolutions-IAM5",
        reason: "The permissions are scoped to lex bots and lambda functions within the account or to specific connect instances. The suppression also applies to xray and logging",
      },
    ]);

    // Using non-null operator at end of env vars to allow it to pass through typescript
    // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-0.html#non-null-assertion-operator
    // const connectInstanceId : string = process.env.CONNECT_INSTANCEID!
    const env: string = process.env.ENVIRONMENT!;
    const app: string = process.env.APP!;
    const account: string = process.env.ACCOUNT!;
    const branch: string = process.env.BRANCH!;
    const commit_id: string = process.env.COMMIT_ID!;
    const region = new CfnParameter(this, "deployRegion", {
      type: "String",
      description: "The region for the deployment.",
    });

    // Get Connect Instance ID from SSM
    const connectInstanceId = ssm.StringParameter.valueForStringParameter(
      this,
      "AmazonConnectInstanceId"
    );

    // Get Artifact Bucket Name from SSM. Using the regioanl callflow buckets to store lambdas and layers for deployment.

    // const devopsArtifactBucket = ssm.StringParameter.valueForStringParameter(this, 'devopsArtifactBucketParam')
    const callflowBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      `/${app}/${env}/ssmCallflowBucketName`
    );

    // const ssmBasePath = `/${app}/${env}/`
    // const callflowBucketName = ssm.StringParameter.valueForStringParameter(this, ssmBasePath+'ssmCallflowBucketName')

    // Instantiate a new instance of the construct factory to create common infrastructure

    const factory = new ConstructFactory(this, "lambda-stack");

    //  Create Lambda(s) and associated roles and policies

    const basicLambdaRole = factory.createLambdaRole(`BasicLambdaRole`, region);
    const provisionerLambdaRole = factory.createLambdaRole(
      "ProvisionerLambdaRole",
      region
    );

    const basicLambdaPolicy = new iam.Policy(this, "basicLambdaPolicy", {
      statements: [
        new iam.PolicyStatement({
          sid: "xrayPolicies",
          actions: [
            "xray:PutTraceSegments",
            "xray:PutTelemetryRecords",
            "xray:GetSamplingRules",
            "xray:GetSamplingTargets",
            "xray:GetSamplingStatisticSummaries",
          ],
          resources: ["*"],
        }),
        new iam.PolicyStatement({
          sid: "lambdaLoggingPolicies",
          actions: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
          ],
          resources: ["*"],
        }),
      ],
    });

    const connectPolicy = new iam.Policy(this, "connectPolicy", {
      statements: [
        new iam.PolicyStatement({
          sid: "connectPolicies",
          actions: [
            "connect:Associate*",
            "connect:CreateContactFlow",
            "connect:CreateContactFlowModule",
            "connect:DeleteContactFlow",
            "connect:DeleteContactFlowmodule",
            "connect:Describe*",
            "connect:DisassociateBot*",
            "connect:Get*",
            "connect:List*",
            "connect:UpdateContactFlowContent",
            "connect:UpdateContactFlowName",
            "connect:UpdateContactFlowMetadata",
            "connect:UpdateContactFlowModuleContent",
            "connect:UpdateContactFlowModulemetadata",
            "connect:UpdateContactFlowContent",
            "connect:UpdateInstanceStorageConfig",
            "connect:UpdateQueueName",
          ],
          resources: [
            `arn:aws:connect:*:${account}:instance/${connectInstanceId}/*`,
            `arn:aws:connect:*:${account}:instance/${connectInstanceId}`,
          ],
        }),
        new iam.PolicyStatement({
          sid: "ssmPolicies",
          actions: [
            "ssm:PutParameter",
            "ssm:DeleteParameter",
            "ssm:GetParameterHistory",
            "ssm:GetParameters",
            "ssm:GetParameter",
            "ssm:DeleteParameters",
          ],
          resources: [`arn:aws:ssm:*:${account}:parameter/*`],
        }),
        new iam.PolicyStatement({
          sid: "s3Policies",
          actions: [
            "s3:ListBucket*",
            "s3:GetBucket*",
            "s3:GetObject*",
            "s3:PutObject*"
          ],
          resources: [
            `arn:aws:s3:::${callflowBucketName}`,
            `arn:aws:s3:::${callflowBucketName}/*`
        ]
        }),
        new iam.PolicyStatement({
          sid: "lexPolicies",
          actions: [
            "lex:DescribeBotAlias",
            "lex:CreateResourcePolicy*",
            "lex:UpdateResourcePolicy",
            "lex:List*",
          ],
          resources: [`arn:aws:lex:*:${account}:*`],
        }),
        new iam.PolicyStatement({
          sid: "lambdaPolicies",
          actions: ["lambda:AddPermission*", "lambda:UpdateFunctionCode*"],
          resources: [`arn:aws:lambda:*:${account}:function:*`],
        }),
      ],
    });

    basicLambdaRole.attachInlinePolicy(basicLambdaPolicy);
    provisionerLambdaRole.attachInlinePolicy(basicLambdaPolicy);
    provisionerLambdaRole.attachInlinePolicy(connectPolicy);

    const importedBucketFromName = s3.Bucket.fromBucketName(
      this,
      `${callflowBucketName}`,
      `${callflowBucketName}`
    );

    const layers = [
      factory.createLayerVersion(
        "ConfigLayer",
        "lambda-stack/layers/aws-layer",
        importedBucketFromName,
        `assets/${branch}/aws-layer-${commit_id}.zip`
      ),
    ];

    const functionEnv = {
      FUNCTION_ENV: env,
      FUNCTION_APP: app,
      FUNCTION_ACCOUNT: account,
      BUCKET: callflowBucketName,
      CONNECT_INSTANCEID: connectInstanceId,
      COMMIT_ID: commit_id,
    };

    const callflowProvisioner = factory.createFunction(
      `callflowProvisioner`,
      `callflowProvisioner`,
      provisionerLambdaRole,
      functionEnv,
      layers,
      Duration.seconds(30),
      1024,
      Tracing.ACTIVE,
      undefined,
      importedBucketFromName,
      `assets/${branch}/callflowProvisioner-${commit_id}.zip`
    );

    const mappingFunction = factory.createFunction(
      `mappingFunction`,
      `mappingFunction`,
      basicLambdaRole,
      functionEnv,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      importedBucketFromName,
      `assets/${branch}/mappingFunction-${commit_id}.zip`
    );

    // SSM Parameters.

    factory.createStringSsmParam(
      `ssmMappingFunctionName`,
      `/${app}/${env}/MappingFunctionName`,
      mappingFunction.functionName
    );

    factory.createStringSsmParam(
      `ssmMappingFunctionArn`,
      `/${app}/${env}/MappingFunctionArn`,
      mappingFunction.functionArn
    );

    factory.createStringSsmParam(
      `ssmcallflowProvisioner`,
      `/${app}/${env}/callflowProvisionernArn`,
      callflowProvisioner.functionArn
    );

    // Outputs

    new CfnOutput(this, `${this.stackName}-mappingFunction`, {
      value: mappingFunction.functionArn,
    });

    new CfnOutput(this, `${this.stackName}-callflowProvisioner`, {
      value: callflowProvisioner.functionArn,
    });
  }
}
