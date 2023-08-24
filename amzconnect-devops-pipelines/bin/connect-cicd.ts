#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack/pipeline-stack';
import { AwsSolutionsChecks } from 'cdk-nag'
import { Aspects } from 'aws-cdk-lib';
import { NagSuppressions } from "cdk-nag";
import awsRegions from 'aws-regions';

const app = new cdk.App();


import devopsProperties from '../env/devops.json';
import accountvars from '../env/accountvars.json';
const devopsArtifactBucketName = `devops-artifacts-${devopsProperties.account}`

//* CDK Nag checks

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))

new PipelineStack(app, `CICDStack`, {
    env: devopsProperties,
    description: "This stack deploys the pipelines necessary for Amazon Connect CI/CD into the DevOps account",
    accountvars: accountvars,
    devopsProperties: devopsProperties,
    devopsArtifactBucketName: devopsArtifactBucketName,
    // pipelineBase: 'CICD-Workshop'
})

// for loop
// const connectRegions = ["us-east-1", "us-west-2", "af-south-1", "ap-northeast-2", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ca-central-1","eu-central-1",  "eu-west-2", "us-gov-west-1"]
const connectRegions = awsRegions.list().map(item => item.code)
console.log(connectRegions)
for (const idx in connectRegions) {
    // console.log(idx)
    const crossRegionStack = app.node.tryFindChild(`cross-region-stack-${devopsProperties.account}:${connectRegions[idx]}`) as cdk.Stack
    if (crossRegionStack != undefined) {
        console.log(`Adding suppressions for ${crossRegionStack}`)
        NagSuppressions.addStackSuppressions(crossRegionStack, [
            {
            id: 'AwsSolutions-S1',
            reason: 'This is part of the cross-region-stack component of CDK and not adjustable',
            },
            {
                id: 'AwsSolutions-KMS5',
                reason: 'This is part of the cross-region-stack component of CDK and not adjustable',
            },
        ]); 
    } 
}