#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfraStack } from '../lib/infra-stack/infra-stack';
import { AwsSolutionsChecks } from 'cdk-nag'
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();

import devopsProperties from '../env/devops.json';

// CDK Nag
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))

new InfraStack(app, `InfraStack`, {
    env: devopsProperties,
    description: "This stack deploys the infrastructure necessary for Amazon Connect into an SDLC environment account",
})