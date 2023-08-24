import { Stack, StackProps, CfnOutput, CfnParameter, Fn } from "aws-cdk-lib";
import * as fs from "fs";
import { Construct } from "constructs";
import { aws_iam as iam } from "aws-cdk-lib";
import { aws_stepfunctions as stepfunctions } from "aws-cdk-lib";
import { aws_logs as logs } from "aws-cdk-lib";
import { ConstructFactory } from "../common/construct-factory";
import { NagSuppressions } from "cdk-nag";
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';

export type InstanceStackProps = StackProps;

export class InstanceStack extends Stack {
  constructor(scope: Construct, id: string, props: InstanceStackProps) {
    super(scope, id, props);

    //  CDK Nag Suppressions

    // NagSuppressions.addStackSuppressions(this, [
    //   {
    //     id: "AwsSolutions-IAM4",
    //     reason: "This suppresses a standard xray policy as well as Connect access for the stepfunction",
    //   },
    // ]);

    // Using non-null operator at end of env vars to allow it to pass through typescript
    // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-0.html#non-null-assertion-operator
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const env: string = process.env.ENVIRONMENT!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const app: string = process.env.APP!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const account: string = process.env.ACCOUNT!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const region = new CfnParameter(this, "deployRegion", {
        type: "String",
        description: "The region for the deployment."
    });

    // Instantiate a new instance of the construct factory to create common infrastructure

    const factory = new ConstructFactory(this, "instance-stack");

    // Log group for SF
    const sfLogGroup = new logs.LogGroup(this, "stepfunctionLogs");

    // Step Function Policy

    const sfPolicy = new iam.Policy(this, "sfPolicy", {
      statements: [
        new iam.PolicyStatement({
          sid: "s3Policies",
          actions: [
            "s3:CreateBucket",
            "s3:ListBucket",
            "s3:GetBucketAcl",
            "s3:GetBucketLocation",
            "iam:PutRolePolicy",
          ],
          resources: [`*`],
        }),
        new iam.PolicyStatement({
          sid: "ssmPolicies",
          actions: ["ssm:PutParameter", "ssm:GetParameter"],
          resources: [
            `arn:aws:ssm:${region.valueAsString}:${account}:parameter/${app}/${env}/ssmStepFunctionArn`,
            `arn:aws:ssm:${region.valueAsString}:${account}:parameter/AmazonConnectInstanceName`,
            `arn:aws:ssm:${region.valueAsString}:${account}:parameter/AmazonConnectBucketName`,
            `arn:aws:ssm:${region.valueAsString}:${account}:parameter/AmazonConnectInstanceId`,
          ],
        }),
        new iam.PolicyStatement({
            sid: "loggingPolicies",
            actions: [
                "logs:CreateLogDelivery",
                "logs:GetLogDelivery",
                "logs:UpdateLogDelivery",
                "logs:DeleteLogDelivery",
                "logs:ListLogDeliveries",
                "logs:PutLogEvents",
                "logs:PutResourcePolicy",
                "logs:DescribeResourcePolicies",
                "logs:DescribeLogGroups"
            ],
            resources: [ 
                "*"
             ],
        }),
        new iam.PolicyStatement({
            sid: "xrayPolicies",
            actions: [
                "xray:PutTraceSegments",
                "xray:PutTelemetryRecords",
                "xray:GetSamplingRules",
                "xray:GetSamplingTargets",
                "xray:GetSamplingStatisticSummaries"
            ],
            resources: [ 
                "*"
            ],
        }),
        new iam.PolicyStatement({
            sid: "ConnectFullAccess",
            actions: [
                "connect:*",
                "ds:CreateAlias",
                "ds:AuthorizeApplication",
                "ds:CreateIdentityPoolDirectory",
                "ds:DeleteDirectory",
                "ds:DescribeDirectories",
                "ds:UnauthorizeApplication",
                "firehose:DescribeDeliveryStream",
                "firehose:ListDeliveryStreams",
                "kinesis:DescribeStream",
                "kinesis:ListStreams",
                "kms:DescribeKey",
                "kms:ListAliases",
                "lex:GetBots",
                "lex:ListBots",
                "lex:ListBotAliases",
                "logs:CreateLogGroup",
                "s3:GetBucketLocation",
                "s3:ListAllMyBuckets",
                "lambda:ListFunctions",
                "ds:CheckAlias",
                "profile:ListAccountIntegrations",
                "profile:GetDomain",
                "profile:ListDomains",
                "profile:GetProfileObjectType",
                "profile:ListProfileObjectTypeTemplates"
            ],
            resources: [ 
                "*"
            ],
        }),
        new iam.PolicyStatement({
            sid: "ConnectIamPolicies",
            actions: [
                "iam:CreateServiceLinkedRole"
            ],
            resources: [ 
                "*"
            ],
            conditions: {
                "StringEquals": {
                    "iam:AWSServiceName": "connect.amazonaws.com"
                }
            }
        }),
      ],
    });
    NagSuppressions.addResourceSuppressions(sfPolicy, [
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Resource * applies to resources in the policy which are unknown. This stepfunction is creating the connect instance, s3 bucket, and xray resources. In case of logging there appears to be a bug that will cause a failure if this is NOT a *",
      },
    ]);

    // IAM role for step function.

    const sfRole = new Role(this, id, {
        roleName: Fn.join('-', [app, `instance`, env, region.valueAsString]),
        assumedBy: new ServicePrincipal('states.amazonaws.com', {region: region.valueAsString}),
        // managedPolicies: [
        //     ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
        //     ManagedPolicy.fromAwsManagedPolicyName('AmazonConnect_FullAccess')
        // ]
    });

    // Step Function

    const aslFile = fs.readFileSync(
      "./lib/instance-stack/stepfunction/definition-asl.json"
    );

    sfRole.attachInlinePolicy(sfPolicy);

    const instanceStateMachine = new stepfunctions.CfnStateMachine(
      this,
      `InstanceStateMachine-${env}`,
      {
        roleArn: sfRole.roleArn,
        definitionString: aslFile.toString(),
        loggingConfiguration: {
            destinations: [{
                cloudWatchLogsLogGroup: {
                logGroupArn: sfLogGroup.logGroupArn,
                },
            }],
            includeExecutionData: false,
            level: 'ALL',
        },
        tracingConfiguration: {
        enabled: true,
        }
      }
    );

    instanceStateMachine.node.addDependency(sfLogGroup);
    instanceStateMachine.node.addDependency(sfRole);
    instanceStateMachine.node.addDependency(sfPolicy);

    //  SSM Parameters

    factory.createStringSsmParam(
      `ssmStepFunctionArn`,
      `/${app}/${env}/ssmStepFunctionArn`,
      instanceStateMachine.attrArn
    );

    const config = fs.readFileSync("./lib/instance-stack/configuration.json");
    const parsedConfig = JSON.parse(config.toString());
    const instanceName = parsedConfig.instanceAlias.toLowerCase() ;
    const bucketName = parsedConfig.instanceStorageBucketName.toLowerCase();

    factory.createStringSsmParam(
      `ssmConnectInstanceName`,
      `AmazonConnectInstanceName`,
      `${instanceName}-${env}-${region.valueAsString}`
    );

    //*TODO It appears bucket param unnecessary as it is overwritten in step function to use instance alias anyway.


    factory.createStringSsmParam(
        `ssmConnectBucketName`,
        `AmazonConnectBucketName`,
        `${bucketName}-${env}-${region.valueAsString}`
    )

    // Outputs

    new CfnOutput(this, `${this.stackName}-StepFunction`, {
      value: instanceStateMachine.attrArn,
    });
  }
}
