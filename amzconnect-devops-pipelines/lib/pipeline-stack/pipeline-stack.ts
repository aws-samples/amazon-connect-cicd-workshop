// import * as cdk from 'aws-cdk-lib';
// import * as pipelines from 'aws-cdk-lib/pipelines';
// import * as path from 'path';
// import * as fs from 'fs';
import {
  Stack,
  StackProps,
  CfnOutput,
//   CfnParameter,
  RemovalPolicy,
  Duration,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { aws_codebuild as codebuild } from "aws-cdk-lib";
import { aws_codepipeline as codepipeline } from "aws-cdk-lib";
import { aws_codepipeline_actions as codepipeline_actions } from "aws-cdk-lib";
import { aws_kms as kms } from "aws-cdk-lib";
import { aws_iam as iam } from "aws-cdk-lib";
import { aws_secretsmanager as secretsmanager, SecretValue } from "aws-cdk-lib";
import { aws_s3 as s3 } from "aws-cdk-lib";
import { aws_sns as sns } from "aws-cdk-lib";
import { aws_logs as logs } from "aws-cdk-lib";
// import { aws_ssm as ssm}  from 'aws-cdk-lib';
import { aws_apigateway as apigateway } from "aws-cdk-lib";
import { Tracing } from "aws-cdk-lib/aws-lambda";
import { ConstructFactory } from "../common/construct-factory";
import { NagSuppressions } from "cdk-nag";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";

//! eslint-disable-next-line @typescript-eslint/no-unused-vars
export type Accountvars = {
    accounts: Account[];
}

export type Account = {
    env:     string;
    branch:  string;
    enabled: boolean;
    account: string;
    region:  string[];
    app:     string;
}

export type Devopsproperties = {
    env:         string;
    account:     string;
    region:      string;
    codestarArn: string;
    repo:        string;
    owner:       string;
    email:       string;
}

export type PipelineStackProps = {
  readonly accountvars: Accountvars;
  readonly devopsProperties: Devopsproperties;
//   readonly pipelineBase: string;
  readonly devopsArtifactBucketName: string;
} & StackProps;

export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    NagSuppressions.addStackSuppressions(this, [
      {
        id: "AwsSolutions-IAM4",
        reason: "This is a cdk managed role in cross-region stack that was not specifically created. Created as part of RestAPI cdk module",
      },
      {
        id: "AwsSolutions-IAM5",
        reason: "There are two reasons for this suppresion. The majority are policies defined by CDK construct giving permissions to resources or the resource unknown at time of deployment ",
      },
      {
        id: "AwsSolutions-APIG4",
        reason: "Authorization for API GW performed at backend lambda function",
      },
      {
        id: "AwsSolutions-COG4",
        reason: "Authorization for API GW performed at backend lambda function",
      },
      {
        id: "AwsSolutions-SMG4",
        reason:
          "The github webhook secret will need to be rotated manually and synchronized with changing the webhook in Github as well",
      },
      {
        id: "AwsSolutions-KMS5",
        reason: "Key rotation unnecessary for workshop",
      },
      {
        id: "AwsSolutions-S1",
        reason: "Server access logging unnecessary for workshop",
      },
    ]);

    //* Get properties from passed in values

    const accountvars = props.accountvars;
    // const pipelineBase = props.pipelineBase
    const devopsProperties = props.devopsProperties;
    const devopsArtifactBucketName = props.devopsArtifactBucketName;

    //* Instantiate a new instance of the construct factory to create common infrastructure

    const factory = new ConstructFactory(this, "pipeline-stack");

    //* Create Github Webhook Secret
    const githubWebhookSecret = new secretsmanager.Secret(this, "Secret", {
      description: `Github Webhook Secret Value`,
      secretName: `githubWebhookSecret`,
      secretStringValue: SecretValue.unsafePlainText(`CHANGEME`),
    });

    //*  Create Lambda(s) and associated roles and policies

    const basicLambdaRole = factory.createLambdaRole(
      `BasicLambdaRole-${devopsProperties.region}`
    );

    const codepipelinePolicy = new iam.Policy(this, "codepipelinePolicy", {
      statements: [
        new iam.PolicyStatement({
          sid: "codepipelinePolicies",
          actions: ["codepipeline:StartPipelineExecution"],
          resources: [`arn:aws:codepipeline:${this.region}:${this.account}:*`],
        }),
        new iam.PolicyStatement({
          sid: "ssmPolicies",
          actions: ["ssm:GetParameter"],
          resources: [
            `arn:aws:ssm:${this.region}:${this.account}:parameter/devopsArtifactBucketParam`,
          ],
        }),
        new iam.PolicyStatement({
          sid: "secretsMangerPolicies",
          actions: [
            "secretsmanager:GetResourcePolicy",
            "secretsmanager:GetSecretValue",
            "secretsmanager:DescribeSecret",
            "secretsmanager:ListSecretVersionIds",
          ],
          resources: [githubWebhookSecret.secretArn],
        }),
      ],
    });

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

    basicLambdaRole.attachInlinePolicy(codepipelinePolicy);
    basicLambdaRole.attachInlinePolicy(basicLambdaPolicy);

    const layers = [
      factory.createLayerVersion(
        "ConfigLayer",
        "pipeline-stack/layers/aws-layer"
      ),
    ];
    const githubRouter = factory.createFunction(
      `githubRouter`,
      `githubRouter`,
      basicLambdaRole,
      { SECRET_ARN: githubWebhookSecret.secretArn },
      layers,
      Duration.seconds(30),
      512,
      Tracing.ACTIVE
    );

    const apiLogGroup = new logs.LogGroup(this, "apigatewayLogs");

    const githubRouterApi = factory.createRestApi(
      `githubRouterApi`,
      `githubRouterApi`,
      {
        dataTraceEnabled: true,
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        accessLogDestination: new apigateway.LogGroupLogDestination(
          apiLogGroup
        ),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
      }
    );
    NagSuppressions.addResourceSuppressions(githubRouterApi, [
      {
        id: "AwsSolutions-APIG2",
        reason: "request validation unnecessary for workshop",
      },
    ]);

    const repoEvents = githubRouterApi.root.addResource("repoEvents");
    repoEvents.addMethod(
      "POST",
      new apigateway.LambdaIntegration(githubRouter)
    );

    const key = new kms.Key(this, "ArtifactKey", {
      alias: "key/artifacts-key",
      enableKeyRotation: true,
    });

    //! Change bucket retention policy back to RETAIN. During developmnent want DESTROY
    const devopsArtifactBucket = new s3.Bucket(this, "devopsArtifactBucket", {
      bucketName: `${devopsArtifactBucketName}`,
      removalPolicy: RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });
    NagSuppressions.addResourceSuppressions(devopsArtifactBucket, [
      {
        id: "AwsSolutions-S1",
        reason: "server access logging unnecessary for workshop",
      },
    ]);

    const snskey = new kms.Key(this, "SNSKey", {
      alias: "key/sns-key",
      enableKeyRotation: true,
    });

    const snsNotifyManualApprovals = new sns.Topic(
      this,
      "snsNotifyManualApprovals",
      {
        topicName: "snsNotifyManualApprovals",
        masterKey: snskey,
      }
    );
    snsNotifyManualApprovals.addSubscription(
      new subs.EmailSubscription(devopsProperties.email)
    );

    const snsNotifyPipelineStatus = new sns.Topic(
      this,
      "snsNotifyPipelineStatus",
      {
        topicName: "snsNotifyPipelineStatus",
        masterKey: snskey,
      }
    );
    snsNotifyPipelineStatus.addSubscription(
      new subs.EmailSubscription(devopsProperties.email)
    );

    //*  SSM Parameter for DevOps artifact bucket

    factory.createStringSsmParam(
      `devopsArtifactBucketParam`,
      `devopsArtifactBucketParam`,
      devopsArtifactBucket.bucketName
    );

    //* Create devops pipeline role and give it permissions to KMS key and devops artifact bucket

    const devopsAccountPrincipal = new iam.AccountPrincipal(
      devopsProperties.account
    );

    key.grantEncryptDecrypt(devopsAccountPrincipal);
    devopsArtifactBucket.grantReadWrite(devopsAccountPrincipal);

    accountvars.accounts.forEach((acct: Account) => {
      const accountPrincipal = new iam.AccountPrincipal(acct.account);
      key.grantDecrypt(accountPrincipal);
      devopsArtifactBucket.grantRead(accountPrincipal);
      devopsArtifactBucket.grantPut(accountPrincipal);
    });

    const pipelineRole = new iam.Role(this, "pipelineRole", {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal("codepipeline.amazonaws.com"),
        new iam.ServicePrincipal("codebuild.amazonaws.com"),
        new iam.ServicePrincipal("cloudformation.amazonaws.com"),
        new iam.ServicePrincipal("states.amazonaws.com")
      ),
      roleName: `devops-pipeline-deployment-role-${devopsProperties.region}`,
    });
    NagSuppressions.addResourceSuppressions(pipelineRole, [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'standard policies applied by CDK',
        //   appliesTo: ['Resource::arn:<AWS::Partition>:codebuild:us-east-1:011371524314:report-group/<cdkStepFunctionInvoke9AFC40B4>-*']
        },
    ]);

    //* Give pipeline deployment role access to devops artifact bucket

    devopsArtifactBucket.grantReadWrite(pipelineRole);
    devopsArtifactBucket.grantPutAcl(pipelineRole);
    snskey.grantEncryptDecrypt(pipelineRole);
    pipelineRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [`*`],
      })
    );

    //* Add permissions to pipeline role to assume deployment role

    accountvars.accounts.forEach((acct: Account) => {
      pipelineRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["sts:AssumeRole"],
          resources: [
            `arn:aws:iam::${acct.account}:role/PipelineDeploymentRole`,
          ],
        })
      );
    });

    const cdkInstanceStepFunction = new codebuild.PipelineProject(
      this,
      "cdkStepFunctionInvoke",
      {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: [
                "cd amzconnect-instance",
                "ls -la",
                "TEMP_ROLE=$(aws sts assume-role --role-arn arn:aws:iam::${ACCOUNT}:role/PipelineDeploymentRole --role-session-name assume-pipeline-role)",
                "export TEMP_ROLE",
                "export AWS_ACCESS_KEY_ID=$(echo \"${TEMP_ROLE}\" | jq -r '.Credentials.AccessKeyId')",
                "export AWS_SECRET_ACCESS_KEY=$(echo \"${TEMP_ROLE}\" | jq -r '.Credentials.SecretAccessKey')",
                "export AWS_SESSION_TOKEN=$(echo \"${TEMP_ROLE}\" | jq -r '.Credentials.SessionToken')",
                "aws sts get-caller-identity",
                "SSM_VALUE=$(aws ssm get-parameter --name /${APP}/${ENVIRONMENT}/ssmStepFunctionArn --region ${REGION})",
                'echo "${SSM_VALUE}"',
                "STEPFUNCTION_ARN=$(echo \"${SSM_VALUE}\" | jq -r '.Parameter.Value')",
                'echo "${STEPFUNCTION_ARN}"',
                'START_RESULT=$(aws stepfunctions start-execution --state-machine-arn  ${STEPFUNCTION_ARN} --region ${REGION} --input "$(jq -R . ./lib/instance-stack/configuration.json --raw-output)")',
                'echo "${START_RESULT}"',
                "START_ARN=$(echo \"${START_RESULT}\" | jq -r '.executionArn')",
                'echo "${START_ARN}"',
                "EXEC_RESULT=$(aws stepfunctions describe-execution --region ${REGION}  --execution-arn \"${START_ARN}\" --query 'status')",
                "echo $EXEC_RESULT",
                "while [ $EXEC_RESULT = '\"RUNNING\"' ]; do sleep 10; EXEC_RESULT=$(aws stepfunctions describe-execution --execution-arn \"${START_ARN}\" --query 'status'); echo $EXEC_RESULT; done",
                "if [ $EXEC_RESULT = '\"FAILED\"' ]; then exit 1; elif [ $EXEC_RESULT = '\"SUCCEEDED\"' ]; then break; fi",
                'echo "Result $EXEC_RESULT"',
              ],
            },
          },
          artifacts: {
            files: ["amzconnect-instance/*"],
          },
        }),
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
        },
        encryptionKey: key,
        role: pipelineRole,
        projectName: "cdkStepFunctionInvoke",
      }
    );

    const cdkInfraSynthCodeBuild = new codebuild.PipelineProject(
      this,
      "cdkInfraDeploy",
      {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: [
                "cd amzconnect-supporting-infra",
                "npm ci",
                "npm run build",
                "npx cdk synth",
                "ls -la cdk.out",
              ],
            },
          },
          artifacts: {
            files: ["amzconnect-supporting-infra/cdk.out/**/*"],
          },
        }),
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
        },
        encryptionKey: key,
        role: pipelineRole,
        projectName: "cdkInfraDeploy",
      }
    );

    const cdkInstanceSynthCodeBuild = new codebuild.PipelineProject(
      this,
      "cdkInstanceStepFunctonDeploy",
      {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: [
                "cd amzconnect-instance",
                "npm ci",
                "npm run build",
                "npx cdk synth",
                "ls -la cdk.out",
              ],
            },
          },
          artifacts: {
            files: ["amzconnect-instance/cdk.out/**/*"],
          },
        }),
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
        },
        encryptionKey: key,
        role: pipelineRole,
        projectName: "cdkInstanceStepFunctionDeploy",
      }
    );

    const cdkLambdaSynthCodeBuild = new codebuild.PipelineProject(
      this,
      "cdkLambdaSynth",
      {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: [
                "cd amzconnect-lambdas",
                "npm install -g aws-cdk@latest",
                // 'npm install cdk-assets',
                "npm ci",
                "npm run build",
                "npx cdk synth",
                "ls -la cdk.out",
              ],
            },
          },
          artifacts: {
            files: ["amzconnect-lambdas/cdk.out/**/*"],
          },
        }),
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
        },
        encryptionKey: key,
        role: pipelineRole,
        projectName: "cdklambdaSynth",
      }
    );

    const cdkContactFlowsDeployCodeBuild = new codebuild.PipelineProject(
      this,
      "cdkContactFlowsDeploy",
      {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: [
                "cd amzconnect-contact-flows/lib/callflows",
                "TEMP_ROLE=$(aws sts assume-role --role-arn arn:aws:iam::${ACCOUNT}:role/PipelineDeploymentRole --role-session-name assume-pipeline-role)",
                "export TEMP_ROLE",
                "export AWS_ACCESS_KEY_ID=$(echo \"${TEMP_ROLE}\" | jq -r '.Credentials.AccessKeyId')",
                "export AWS_SECRET_ACCESS_KEY=$(echo \"${TEMP_ROLE}\" | jq -r '.Credentials.SecretAccessKey')",
                "export AWS_SESSION_TOKEN=$(echo \"${TEMP_ROLE}\" | jq -r '.Credentials.SessionToken')",
                "aws sts get-caller-identity",
                "SSM_VALUE=$(aws ssm get-parameter --name /${APP}/${ENVIRONMENT}/ssmCallflowBucketName --region ${REGION})",
                "LAMBDA_VALUE=$(aws ssm get-parameter --name /${APP}/${ENVIRONMENT}/callflowProvisionernArn --region ${REGION})",
                "MAPPING_LAMBDA_VALUE=$(aws ssm get-parameter --name /${APP}/${ENVIRONMENT}/MappingFunctionArn --region ${REGION})",
                "LEXBOT_VALUE=$(aws ssm get-parameter --name /${APP}/${ENVIRONMENT}/ssmLexBotArn --region ${REGION})",
                "INSTANCEID_VALUE=$(aws ssm get-parameter --name AmazonConnectInstanceId --region ${REGION})",
                'echo "${SSM_VALUE}"',
                'echo "${LAMBDA_VALUE}"',
                'echo "${MAPPING_LAMBDA_VALUE}"',
                'echo "${LEXBOT_VALUE}"',
                "BUCKET=$(echo \"${SSM_VALUE}\" | jq -r '.Parameter.Value')",
                "LAMBDA_ARN=$(echo \"${LAMBDA_VALUE}\" | jq -r '.Parameter.Value')",
                "MAPPING_LAMBDA_ARN=$(echo \"${MAPPING_LAMBDA_VALUE}\" | jq -r '.Parameter.Value')",
                "LEXBOT_ARN=$(echo \"${LEXBOT_VALUE}\" | jq -r '.Parameter.Value')",
                "INSTANCEID=$(echo \"${INSTANCEID_VALUE}\" | jq -r '.Parameter.Value')",
                "RESPONSE=$(aws s3 sync . s3://${BUCKET}/callflows --delete --region ${REGION})",
                'echo "${RESPONSE}"',
                "aws lambda invoke --function-name ${LAMBDA_ARN} --cli-binary-format raw-in-base64-out --payload '{}' response.json --region ${REGION}",
                "echo Attaching mapping lambda to connect instance",
                "aws connect associate-lambda-function --instance-id ${INSTANCEID} --function-arn ${MAPPING_LAMBDA_ARN} --region ${REGION}",
                "echo Attaching lex bot to connect instance",
                "aws connect associate-bot --instance-id ${INSTANCEID} --lex-v2-bot AliasArn=${LEXBOT_ARN} --region ${REGION}",
              ],
            },
          },
        }),
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
        },
        encryptionKey: key,
        role: pipelineRole,
        projectName: "cdkContactFlowsDeploy",
      }
    );

    const cdkLambdaTestingCodeBuild = new codebuild.PipelineProject(
      this,
      "cdkLambdaTesting",
      {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: ["cd amzconnect-lambdas", 'echo "Tests Live Here"'],
            },
          },
        }),
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
        },
        encryptionKey: key,
        role: pipelineRole,
        projectName: "cdklambdaTesting",
      }
    );

    const cdkLambdaAssetsCodeBuild = new codebuild.PipelineProject(
      this,
      "cdkLambdaAssets",
      {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: [
                "npm install -g aws-cdk@latest",
                "cd amzconnect-lambdas",
                "npm ci",
                "npm run build",
                "rm -rf /tmp/assetzips && mkdir /tmp/assetzips",
                "cd bin/lib/lambda-stack/layers",
                "for dir in *; do cd $dir && zip -r /tmp/assetzips/$dir.zip * && zip -r /tmp/assetzips/$dir-$COMMIT_ID.zip *; done",
                "cd ../../lambdas",
                "for dir in *; do cd $dir && zip -r /tmp/assetzips/$dir.zip * && zip -r /tmp/assetzips/$dir-$COMMIT_ID.zip *&& cd .. ; done",
                "ls -la /tmp/assetzips",
                "TEMP_ROLE=$(aws sts assume-role --role-arn arn:aws:iam::${ACCOUNT}:role/PipelineDeploymentRole --role-session-name assume-pipeline-role)",
                "export TEMP_ROLE",
                "export AWS_ACCESS_KEY_ID=$(echo \"${TEMP_ROLE}\" | jq -r '.Credentials.AccessKeyId')",
                "export AWS_SECRET_ACCESS_KEY=$(echo \"${TEMP_ROLE}\" | jq -r '.Credentials.SecretAccessKey')",
                "export AWS_SESSION_TOKEN=$(echo \"${TEMP_ROLE}\" | jq -r '.Credentials.SessionToken')",
                "aws sts get-caller-identity",
                "SSM_VALUE=$(aws ssm get-parameter --name /${APP}/${ENVIRONMENT}/ssmCallflowBucketName --region ${REGION})",
                "BUCKET=$(echo \"${SSM_VALUE}\" | jq -r '.Parameter.Value')",
                "echo $BUCKET",
                "RESPONSE=$(aws s3 sync /tmp/assetzips s3://${BUCKET}/assets/${BRANCH}/)",
                "echo $RESPONSE",
              ],
            },
          },
        }),
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
        },
        encryptionKey: key,
        role: pipelineRole,
        projectName: "cdklambdaAssets",
      }
    );

    const sourceOutput = new codepipeline.Artifact();
    const cdkSynthOutput = new codepipeline.Artifact("cdkSynthOutput");

    //* Get repo values from devopsProperties
    const codestarArn = devopsProperties.codestarArn;
    const repo = devopsProperties.repo;
    const owner = devopsProperties.owner;

    //* Give pipeline deployment roles access to KMS key

    accountvars.accounts.forEach((acct: Account) => {
      const deploymentRole = iam.Role.fromRoleArn(
        this,
        `${acct.env}DeploymentRole`,
        `arn:aws:iam::${acct.account}:role/PipelineDeploymentRole`
      );
      // Grant deployment role access to artifact bucket and kms key
      key.grantDecrypt(deploymentRole);
      snskey.grantDecrypt(deploymentRole);
      devopsArtifactBucket.grantRead(deploymentRole);
      devopsArtifactBucket.grantPut(deploymentRole);

      // Connect Instance Pipeline using step functions

      const instancePipeline = new codepipeline.Pipeline(
        this,
        `amzconnect-instance-${acct.branch}`,
        {
          pipelineName: `amzconnect-instance-${acct.branch}`,
          role: pipelineRole,
          artifactBucket: devopsArtifactBucket,
          // crossAccountKeys: false,
          // reuseCrossRegionSupportStacks: true
        }
      );

      instancePipeline.addStage({
        stageName: "Source",
        actions: [
          new codepipeline_actions.CodeStarConnectionsSourceAction({
            actionName: "Github_Source",
            repo: repo,
            owner: owner,
            branch: `${acct.branch}`,
            output: sourceOutput,
            role: pipelineRole,
            connectionArn: codestarArn,
            triggerOnPush: false,
            variablesNamespace: "SourceVariables",
          }),
        ],
      });

      instancePipeline.addStage({
        stageName: "Synth",
        actions: [
          new codepipeline_actions.CodeBuildAction({
            actionName: "run_cdk_synth",
            project: cdkInstanceSynthCodeBuild,
            role: pipelineRole,
            environmentVariables: {
              ENVIRONMENT: { value: acct.env },
              BRANCH: { value: acct.branch },
              ACCOUNT: { value: acct.account },
              APP: { value: acct.app },
            },
            input: sourceOutput,
            // extraInputs: [ appBuildOutput ],
            outputs: [cdkSynthOutput],
            // variablesNamespace: 'urlOutput'
          }),
        ],
      });

      if (acct.env == "prod") {
        instancePipeline.addStage({
          stageName: "ManualApproval",
          actions: [
            new codepipeline_actions.ManualApprovalAction({
              actionName: "Manual_Approval",
              role: pipelineRole,
              notificationTopic: snsNotifyManualApprovals,
              externalEntityLink:
                "https://github.com/#{SourceVariables.FullRepositoryName}/commit/#{SourceVariables.CommitId}",
              additionalInformation:
                "Review output from previous stage and provide approval. CommitMessage: #{SourceVariables.CommitMessage}",
            }),
          ],
        });
      }

      for (const reg of acct.region) {
        instancePipeline.addStage({
          stageName: `Regional_Deployments-${reg}`,
          actions: [
            new codepipeline_actions.ManualApprovalAction({
              actionName: "Manual_Approval",
              role: pipelineRole,
              notificationTopic: snsNotifyManualApprovals,
              externalEntityLink:
                "https://github.com/#{SourceVariables.FullRepositoryName}/commit/#{SourceVariables.CommitId}",
              additionalInformation:
                "Review output from previous stage and provide approval. CommitMessage: #{SourceVariables.CommitMessage}",
              runOrder: 1,
            }),
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: "Cloudformation_CreateStack",
              stackName: `amzconnect-instance-${acct.branch}-deployment`,
              adminPermissions: true,
              account: `${acct.account}`,
              region: `${reg}`,
              deploymentRole: deploymentRole,
              role: deploymentRole,
              templatePath: cdkSynthOutput.atPath(
                "amzconnect-instance/cdk.out/InstanceStack.template.json"
              ),
              parameterOverrides: { deployRegion: `${reg}` },
              runOrder: 2,
            }),
            new codepipeline_actions.CodeBuildAction({
              actionName: "invoke_step_function",
              project: cdkInstanceStepFunction,
              role: pipelineRole,
              environmentVariables: {
                ENVIRONMENT: { value: acct.env },
                BRANCH: { value: acct.branch },
                ACCOUNT: { value: acct.account },
                APP: { value: acct.app },
                REGION: { value: reg },
              },
              input: sourceOutput,
              // extraInputs: [ appBuildOutput ],
              // outputs: [cdkSynthOutput],
              // variablesNamespace: 'urlOutput'
              runOrder: 3,
            }),
          ],
        });
      }

      //* Infrastructure Pipeline

      const infraPipeline = new codepipeline.Pipeline(
        this,
        `amzconnect-supporting-infra-${acct.branch}`,
        {
          pipelineName: `amzconnect-supporting-infra-${acct.branch}`,
          role: pipelineRole,
          artifactBucket: devopsArtifactBucket,
          // $crossAccountKeys: true,
        }
      );

      infraPipeline.addStage({
        stageName: "Source",
        actions: [
          new codepipeline_actions.CodeStarConnectionsSourceAction({
            actionName: "Github_Source",
            repo: repo,
            owner: owner,
            branch: `${acct.branch}`,
            output: sourceOutput,
            role: pipelineRole,
            connectionArn: codestarArn,
            triggerOnPush: false,
            variablesNamespace: "SourceVariables",
          }),
        ],
      });

      infraPipeline.addStage({
        stageName: "Synth",
        actions: [
          new codepipeline_actions.CodeBuildAction({
            actionName: "run_cdk_synth",
            project: cdkInfraSynthCodeBuild,
            role: pipelineRole,
            environmentVariables: {
              ENVIRONMENT: { value: acct.env },
              BRANCH: { value: acct.branch },
              ACCOUNT: { value: acct.account },
              APP: { value: acct.app },
            },
            input: sourceOutput,
            // extraInputs: [ appBuildOutput ],
            outputs: [cdkSynthOutput],
            // variablesNamespace: 'urlOutput'
          }),
        ],
      });

      if (acct.env == "prod") {
        infraPipeline.addStage({
          stageName: "ManualApproval",
          actions: [
            new codepipeline_actions.ManualApprovalAction({
              actionName: "Manual_Approval",
              role: pipelineRole,
              notificationTopic: snsNotifyManualApprovals,
              externalEntityLink:
                "https://github.com/#{SourceVariables.FullRepositoryName}/commit/#{SourceVariables.CommitId}",
              additionalInformation:
                "Review output from previous stage and provide approval. CommitMessage: #{SourceVariables.CommitMessage}",
            }),
          ],
        });
      }

      for (const reg of acct.region) {
        infraPipeline.addStage({
          stageName: `Regional_Deploy-${reg}`,
          actions: [
            new codepipeline_actions.ManualApprovalAction({
              actionName: "Manual_Approval",
              role: pipelineRole,
              notificationTopic: snsNotifyManualApprovals,
              externalEntityLink:
                "https://github.com/#{SourceVariables.FullRepositoryName}/commit/#{SourceVariables.CommitId}",
              additionalInformation:
                "Review output from previous stage and provide approval. CommitMessage: #{SourceVariables.CommitMessage}",
              runOrder: 1,
            }),
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: "Cloudformation_CreateStack",
              stackName: `amzconnect-supporting-infra-${acct.branch}-deployment`,
              adminPermissions: true,
              account: `${acct.account}`,
              region: `${reg}`,
              deploymentRole: deploymentRole,
              role: deploymentRole,
              templatePath: cdkSynthOutput.atPath(
                "amzconnect-supporting-infra/cdk.out/InfraStack.template.json"
              ),
              parameterOverrides: { deployRegion: `${reg}` },
              runOrder: 2,
            }),
          ],
        });
      }

      //* Lambda Pipeline

      const lambdaPipeline = new codepipeline.Pipeline(
        this,
        `amzconnect-lambdas-${acct.branch}`,
        {
          pipelineName: `amzconnect-lambdas-${acct.branch}`,
          role: pipelineRole,
          artifactBucket: devopsArtifactBucket,
          // $crossAccountKeys: true,
        }
      );

      lambdaPipeline.addStage({
        stageName: "Source",
        actions: [
          new codepipeline_actions.CodeStarConnectionsSourceAction({
            actionName: "Github_Source",
            repo: repo,
            owner: owner,
            branch: `${acct.branch}`,
            output: sourceOutput,
            role: pipelineRole,
            connectionArn: codestarArn,
            triggerOnPush: false,
            variablesNamespace: "SourceVariables",
          }),
        ],
      });

      lambdaPipeline.addStage({
        stageName: "Synth",
        actions: [
          new codepipeline_actions.CodeBuildAction({
            actionName: "run_cdk_synth",
            project: cdkLambdaSynthCodeBuild,
            role: pipelineRole,
            environmentVariables: {
              ENVIRONMENT: { value: acct.env },
              BRANCH: { value: acct.branch },
              ACCOUNT: { value: acct.account },
              APP: { value: acct.app },
              COMMIT_ID: { value: "#{SourceVariables.CommitId}" },
            },
            input: sourceOutput,
            // extraInputs: [ appBuildOutput ],
            outputs: [cdkSynthOutput],
          }),
        ],
      });

      lambdaPipeline.addStage({
        stageName: "Testing",
        actions: [
          new codepipeline_actions.CodeBuildAction({
            actionName: "run_tests",
            project: cdkLambdaTestingCodeBuild,
            role: pipelineRole,
            environmentVariables: {
              ENVIRONMENT: { value: acct.env },
              BRANCH: { value: acct.branch },
              ACCOUNT: { value: acct.account },
              APP: { value: acct.app },
              // REGION: {value: acct.region}
            },
            input: sourceOutput,
            // extraInputs: [ appBuildOutput ],
            // outputs: [cdkSynthOutput],
          }),
        ],
      });

      if (acct.env == "prod") {
        lambdaPipeline.addStage({
          stageName: "ManualApproval",
          actions: [
            new codepipeline_actions.ManualApprovalAction({
              actionName: "Manual_Approval",
              role: pipelineRole,
              notificationTopic: snsNotifyManualApprovals,
              externalEntityLink:
                "https://github.com/#{SourceVariables.FullRepositoryName}/commit/#{SourceVariables.CommitId}",
              additionalInformation:
                "Review output from previous stage and provide approval. CommitMessage: #{SourceVariables.CommitMessage}",
            }),
          ],
        });
      }

      for (const reg of acct.region) {
        lambdaPipeline.addStage({
          stageName: `Deploy-${reg}`,
          actions: [
            new codepipeline_actions.ManualApprovalAction({
              actionName: "Regional_Approval",
              role: pipelineRole,
              notificationTopic: snsNotifyManualApprovals,
              externalEntityLink:
                "https://github.com/#{SourceVariables.FullRepositoryName}/commit/#{SourceVariables.CommitId}",
              additionalInformation:
                "Review output from previous stage and provide approval. CommitMessage: #{SourceVariables.CommitMessage}",
              runOrder: 1,
            }),
            new codepipeline_actions.CodeBuildAction({
              actionName: "Zip_assets_and_copy_to_S3",
              project: cdkLambdaAssetsCodeBuild,
              role: pipelineRole,
              environmentVariables: {
                ENVIRONMENT: { value: acct.env },
                BRANCH: { value: acct.branch },
                ACCOUNT: { value: acct.account },
                APP: { value: acct.app },
                REGION: { value: reg },
                COMMIT_ID: { value: "#{SourceVariables.CommitId}" },
                // BUCKET: {value: devopsArtifactBucket.bucketName}
              },
              input: sourceOutput,
              runOrder: 2,
              // extraInputs: [ appBuildOutput ],
              // outputs: [cdkSynthOutput],
              // variablesNamespace: 'urlOutput'
            }),
            new codepipeline_actions.CloudFormationCreateUpdateStackAction({
              actionName: "Cloudformation_CreateStack",
              stackName: `amzconnect-lambdas-${acct.branch}-deployment`,
              adminPermissions: true,
              account: `${acct.account}`,
              region: `${reg}`,
              deploymentRole: deploymentRole,
              role: deploymentRole,
              templatePath: cdkSynthOutput.atPath(
                "amzconnect-lambdas/cdk.out/LambdaStack.template.json"
              ),
              parameterOverrides: { deployRegion: `${reg}` },
              runOrder: 3,
            }),
          ],
        });
      }

      //* Contact Flow Pipeline

      const contactFlowPipeline = new codepipeline.Pipeline(
        this,
        `amzconnect-contact-flows-${acct.branch}`,
        {
          pipelineName: `amzconnect-contact-flows-${acct.branch}`,
          role: pipelineRole,
          artifactBucket: devopsArtifactBucket,
          // $crossAccountKeys: true,
        }
      );

      contactFlowPipeline.addStage({
        stageName: "Source",
        actions: [
          new codepipeline_actions.CodeStarConnectionsSourceAction({
            actionName: "Github_Source",
            repo: repo,
            owner: owner,
            branch: `${acct.branch}`,
            output: sourceOutput,
            role: pipelineRole,
            connectionArn: codestarArn,
            triggerOnPush: false,
            variablesNamespace: "SourceVariables",
          }),
        ],
      });

      if (acct.env == "prod") {
        contactFlowPipeline.addStage({
          stageName: "ManualApproval",
          actions: [
            new codepipeline_actions.ManualApprovalAction({
              actionName: "Manual_Approval",
              role: pipelineRole,
              notificationTopic: snsNotifyManualApprovals,
              externalEntityLink:
                "https://github.com/#{SourceVariables.FullRepositoryName}/commit/#{SourceVariables.CommitId}",
              additionalInformation:
                "Review output from previous stage and provide approval. CommitMessage: #{SourceVariables.CommitMessage}",
            }),
          ],
        });
      }
      
      for (const reg of acct.region) {
        contactFlowPipeline.addStage({
          stageName: `Deploy-${reg}`,
          actions: [
            new codepipeline_actions.ManualApprovalAction({
              actionName: "Regional_Approval",
              role: pipelineRole,
              notificationTopic: snsNotifyManualApprovals,
              externalEntityLink:
                "https://github.com/#{SourceVariables.FullRepositoryName}/commit/#{SourceVariables.CommitId}",
              additionalInformation:
                "Review output from previous stage and provide approval. CommitMessage: #{SourceVariables.CommitMessage}",
              runOrder: 1,
            }),
            new codepipeline_actions.CodeBuildAction({
              actionName: "contactflow_deploy",
              project: cdkContactFlowsDeployCodeBuild,
              role: pipelineRole,
              environmentVariables: {
                ENVIRONMENT: { value: acct.env },
                BRANCH: { value: acct.branch },
                ACCOUNT: { value: acct.account },
                APP: { value: acct.app },
                REGION: { value: reg },
              },
              input: sourceOutput,
              runOrder: 2,
            }),
          ],
        });
      }
    });



    //* Outputs

    new CfnOutput(this, "devopsArtifactBucketArn", {
      value: devopsArtifactBucket.bucketArn,
    });

    new CfnOutput(this, "artifactsKmsKeyArn", {
      value: key.keyArn,
    });

    new CfnOutput(this, "devopsPipelineRoleArn", {
      value: pipelineRole.roleArn,
    });

    new CfnOutput(this, "githubRouterApiPayloadUrl", {
      value: `${githubRouterApi.deploymentStage.urlForPath()}repoEvents`,
    });

    new CfnOutput(this, "githubRouterFxnName", {
      value: githubRouter.functionArn,
    });
  }
}
