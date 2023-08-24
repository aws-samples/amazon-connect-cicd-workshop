#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InstanceStack } from '../lib/instance-stack/instance-stack';
import { AwsSolutionsChecks } from 'cdk-nag'
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();

import devopsProperties from '../env/devops.json';

// CDK Nag
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))

new InstanceStack(app, `InstanceStack`, {
    env: devopsProperties,
    description: "This stack deploys the step function necessary for creating an Amazon Connect instance in an SDLC environment account",
})
