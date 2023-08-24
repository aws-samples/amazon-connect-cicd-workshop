#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { LambdaStack } from '../lib/lambda-stack/lambda-stack';
import { AwsSolutionsChecks } from 'cdk-nag'
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();

import devopsProperties from '../env/devops.json';

// CDK Nag
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))

new LambdaStack(app, `LambdaStack`, {
    env: devopsProperties,
    description: "This stack deploys the lambda functions necessary for Amazon Connect into an SDLC environment account",
})
