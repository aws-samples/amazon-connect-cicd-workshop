import { Duration, Stack, CfnOutput } from "aws-cdk-lib";
import {
  Cors,
  IRestApi,
  MethodOptions,
  RestApi,
} from "aws-cdk-lib/aws-apigateway";
import {
  Effect,
  IRole,
  ManagedPolicy,
  Policy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {
  Code,
  Function,
  IEventSource,
  IFunction,
  ILayerVersion,
  LayerVersion,
  Runtime,
  Tracing,
} from "aws-cdk-lib/aws-lambda";
import { CfnParameter, Fn } from "aws-cdk-lib";
import { aws_ssm as ssm } from "aws-cdk-lib";
//Lex specific
import { aws_lex as lex } from "aws-cdk-lib";
import { aws_logs as logs } from "aws-cdk-lib";
import { RemovalPolicy } from "aws-cdk-lib";
import { readFileSync } from "fs";

export class ConstructFactory {
  private static ROOT_DIR = "bin/lib";

  private readonly scope: Stack;
  private readonly stackName: string;
  private readonly lambdaDir: string;
  private readonly botsDir: string;
  private readonly apiMap: Map<string, IRestApi>;
  private readonly runtimes: Runtime[];
  private readonly layers: Map<string, ILayerVersion>;

  public constructor(scope: Stack, stackDir: string) {
    this.scope = scope;
    this.lambdaDir = `${ConstructFactory.ROOT_DIR}/${stackDir}`;
    this.botsDir = `${ConstructFactory.ROOT_DIR}/${stackDir}/bots`;
    this.stackName = scope.stackName;
    this.runtimes = [Runtime.NODEJS_16_X];
    this.apiMap = new Map<string, IRestApi>();
    this.layers = new Map<string, ILayerVersion>();
  }

  /**
   * This getter can be used to specify the REST API's default method
   * options.  For example, here you can specify the authorizer type and
   * authorizer itself.  You can always overwrite these options from the
   * client stack.
   *
   * @returns the default REST API method options
   */
  private get methodOptions(): MethodOptions {
    const options: MethodOptions = {
      // TODO: define default options.
    };
    return options;
  }

  createAllowPolicyStatement(resources: string[], actions: string[]) {
    return new PolicyStatement({
      actions,
      effect: Effect.ALLOW,
      resources,
    });
  }
  //
  createLambdaRole(
    id: string,
    region: CfnParameter,
    statements?: PolicyStatement[],
    boundary?: ManagedPolicy
  ): IRole {
    const roleName = `${this.stackName}-${id}`;
    if (roleName.length > 49)
      throw Error(
        `Role name [${roleName}] exceeds potential 64 character max length!`
      );

    const role = new Role(this.scope, id, {
      roleName: Fn.join("-", [id, region.valueAsString]),
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
        ManagedPolicy.fromAwsManagedPolicyName("AWSXRayDaemonWriteAccess"),
      ],
      permissionsBoundary: boundary,
    });

    if (statements?.length ?? 0 > 0) {
      role.attachInlinePolicy(
        new Policy(this.scope, "inlinePolicies", { statements })
      );
    }

    return role;
  }

  createLayerVersion(id: string, dir: string): ILayerVersion {
    let layer = this.layers.get(id);
    if (!layer) {
      layer = new LayerVersion(this.scope, id, {
        layerVersionName: `${this.stackName}-${id}`,
        code: Code.fromAsset(`${ConstructFactory.ROOT_DIR}/${dir}`),
        compatibleRuntimes: this.runtimes,
      });
      this.layers.set(id, layer);
    }
    return layer;
  }

  createFunction(
    id: string,
    dir: string,
    role: IRole,
    env?: { [x: string]: string },
    layers?: ILayerVersion[],
    timeout: Duration = Duration.seconds(3),
    // eslint-disable-next-line @typescript-eslint/no-inferrable-types
    memorySize: number = 512,
    tracing: Tracing = Tracing.DISABLED,
    events?: IEventSource[]
  ): IFunction {
    return new Function(this.scope, id, {
      functionName: `${this.stackName}-${id}`,
      code: Code.fromAsset(`${this.lambdaDir}/lambdas/${dir}`),
      handler: "index.handler",
      runtime: Runtime.NODEJS_16_X,
      environment: env,
      layers,
      role,
      timeout,
      tracing,
      memorySize,
      events,
    });
  }

  createRestApi(id: string, description?: string): IRestApi {
    let api = this.apiMap.get(id);
    if (!api) {
      api = new RestApi(this.scope, id, {
        restApiName: `${this.stackName}-${id}`,
        description,
        defaultCorsPreflightOptions: {
          allowOrigins: Cors.ALL_ORIGINS,
          allowMethods: Cors.ALL_METHODS,
        },
        cloudWatchRole: false,
        defaultMethodOptions: this.methodOptions,
      });
      this.apiMap.set(id, api);
    }
    return api;
  }

  createStringSsmParam(
    id: string,
    name: string,
    value: string,
    description?: string
  ): ssm.CfnParameter {
    return new ssm.CfnParameter(this.scope, id, {
      dataType: "text",
      description,
      name,
      value,
      type: "String",
    });
  }

  //Create Role for Step Function
  createSfRole(
    id: string,
    statements?: PolicyStatement[],
    boundary?: ManagedPolicy
  ): IRole {
    const roleName = `${this.stackName}-${id}`;
    if (roleName.length > 64)
      throw Error(`Role name [${roleName}] exceeds 64 character max length!`);

    const role = new Role(this.scope, id, {
      roleName,
      assumedBy: new ServicePrincipal("states.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
        ManagedPolicy.fromAwsManagedPolicyName("AWSXRayDaemonWriteAccess"),
      ],
      permissionsBoundary: boundary,
    });

    if (statements?.length ?? 0 > 0) {
      role.attachInlinePolicy(
        new Policy(this.scope, "inlinePolicies", { statements })
      );
    }

    return role;
  }

  //Lex specific
  //LexBotRole
  createLexRole(
    id: string,
    region: CfnParameter,
    statements?: PolicyStatement[]
  ): IRole {
    const roleName = `${this.stackName}-${id}`;
    if (roleName.length > 49)
      throw Error(`Role name [${roleName}] exceeds 64 character max length!`);

    const role = new Role(this.scope, id, {
      roleName: Fn.join("-", [id, region.valueAsString]),
      assumedBy: new ServicePrincipal("lexv2.amazonaws.com"),
    });

    if (statements?.length ?? 0 > 0) {
      role.attachInlinePolicy(
        new Policy(this.scope, "inlinePolicies", { statements })
      );
    }

    return role;
  }

  //createLexLogGroup
  createLexLogGroup(id: string) {
    const lgName = `${this.stackName}-${id}`;

    const lg = new logs.LogGroup(this.scope, id, {
      logGroupName: lgName,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    return lg;
  }

  //createLexBot
  createLexBot(id: string, rolearn: string) {
    const localesData = readFileSync(
      `${this.botsDir}/${id}/Locales.json`,
      "utf-8"
    );
    const localesObject = JSON.parse(localesData);

    const lexBot = new lex.CfnBot(this.scope, `${this.stackName}-${id}`, {
      name: id,
      roleArn: rolearn,
      dataPrivacy: { ChildDirected: false },
      idleSessionTtlInSeconds: 300,
      autoBuildBotLocales: true,
      botLocales: localesObject,
    });

    return lexBot;
  }

  //createLexVersion
  createLexVersion(id: string, botId: string, description: string) {
    const vid = id.concat("-", "Version");

    const botVersion = new lex.CfnBotVersion(
      this.scope,
      `${this.stackName}-${vid}`,
      {
        botId: botId,
        description: description,
        botVersionLocaleSpecification: [
          {
            botVersionLocaleDetails: {
              sourceBotVersion: "DRAFT",
            },
            localeId: "en_US",
          },
        ],
      }
    );
    return botVersion;
  }

  //createLexAlias
  createLexAlias(
    id: string,
    botId: string,
    botVer: string,
    aliasName: string,
    lgArn: string
  ) {
    const aliasData = readFileSync(
      `${this.botsDir}/${id}/Aliases.json`,
      "utf-8"
    );
    const aliasObject = JSON.parse(aliasData);
    const aid = id.concat("-", "Alias");
    const logPrefix = "/aws/lex/".concat(id, "/", aliasName, "/");

    const botAlias = new lex.CfnBotAlias(
      this.scope,
      `${this.stackName}-${aid}`,
      {
        botAliasName: aliasName,
        botId: botId,
        botVersion: botVer,
        sentimentAnalysisSettings: { DetectSentiment: true },
        botAliasLocaleSettings: aliasObject,
        conversationLogSettings: {
          textLogSettings: [
            {
              destination: {
                cloudWatch: {
                  cloudWatchLogGroupArn: lgArn,
                  logPrefix: logPrefix,
                },
              },
              enabled: true,
            },
          ],
        },
      }
    );
    return botAlias;
  }

  //Create Lex bot mapping to alias arn for Connect use.
  createLexOutput(name: string, aliasarn: string) {
    new CfnOutput(this.scope, name, { value: aliasarn, exportName: name });
  }
} // class
