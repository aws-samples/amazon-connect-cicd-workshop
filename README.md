# Amazon Connect Automation using AWS Developer Tools, AWS Cloud Development Kit (CDK), and TypeScript
This workshop will teach you how to implement a [Continuous Integration and Continuous Delivery (CI/CD)](https://en.wikipedia.org/wiki/CI/CD) process for a contact center built using [AWS services](https://aws.amazon.com/).  This solution has Multi-Region support, which can be tailored for [Amazon Connect Global Resiliency](https://docs.aws.amazon.com/connect/latest/adminguide/setup-connect-global-resiliency.html)

## Concepts

This pattern uses [AWS CodePipeline](https://aws.amazon.com/codepipeline/) for CI/CD and [AWS CodeBuild](https://aws.amazon.com/codebuild/) as a build service. The code is written in typescript and uses [CDK](https://aws.amazon.com/cdk/) to model the application components.

### CI/CD Pipeline Architecture
 
The pipelines that deploy Amazon Connect and other associated items are installed into a single DevOps tooling account. All pipelines will run here and can deploy to any other supported region. The tooling account and the application account regions are configured independently and don't necessarily need to be the same.

There are four pipelines deployed:
- instance pipeline which creates the Amazon Connect instance itself. 
- supporting-infra pipeline which creates supporting architectures such as lex bots, s3 buckets, and any other resource which is not primarily code.
- lambdas pipeline which creates all associated lambda functions and layers. This is separate so that appropriate testing and security patterns can be run against the code itself.
- contact-flows pipeline which deploys the Amazon Connect contact flows to the instance.

The resources are deployed into the specified account and region first in the primary region and then to other secondary region(s).

![[architecture.png]](images/architecture.png)

### Monorepo Architecture

The four application stacks are stored in a single monorepo. An API gateway backed by routing lambda receives webhooks from Github and starts the specified pipeline based upon the files added or modified. The github webhooks are secured using secrets to verify that all incoming requests are from the legitimate Github repo.


![[Monorepo.png]](images/Monorepo.png)

### Amazon Connect Flows

In [Amazon Connect](https://aws.amazon.com/connect/) deployments it is common to deploy [Amazon Connect Flows](https://docs.aws.amazon.com/connect/latest/adminguide/connect-contact-flows.html) that are created using the [Amazon Connect console](https://console.aws.amazon.com/connect/) which refer to the various [flow block definitions](https://docs.aws.amazon.com/connect/latest/adminguide/contact-block-definitions.html) (e.g., Play prompt, Set working queue, Get customer input, Invoke AWS Lambda function).  These resources included in the flow, such as queues and voice prompts, are referenced within the flow using the name of the resource and the Amazon Resource Name (ARN). The ARN is a unique identifier for a resource that is specific to the service and Region in which the resource is created. The functionality works great in a single account, however it becomes an issue when you need to move those flows between instances in different accounts and regions. The resource ARNs from the source instance need to be mapped to ones on the destination instance. If the names are the same, these resources can usually be resolved, however if they are different, one needs to manually resolve. This can be time consuming and prone to human error when you have multiple instances and a large numbers of flows.

This design uses [Amazon Connect contact attributes](https://docs.aws.amazon.com/connect/latest/adminguide/connect-contact-attributes.html) instead of ARNs.  In the [flow that the phone number is attached to](https://docs.aws.amazon.com/connect/latest/adminguide/associate-claimed-ported-phone-number-to-flow.html) (ACME_Main in our case) there is a mapping Lambda that runs that has an entry for all possible keys that one could encounter within a particular Amazon Connect instance and maps those keys to the corresponding ARN.

This is an Amazon Lex bot example.  
![[lexbot-attribute.png]](images/lexbot-attribute.png)

This is a Set working queue example.  
![[queue-attribute.png]](images/queue-attribute.png)

These flows are then exported from an Amazon Connect flow development instance and added to the repository under amzconnect-contact-flows/lib/callflows.  This is an example flow.
```
{
    "Name": "ACME_agent_whisper",
    "ContactFlowType": "AGENT_WHISPER",
    "Content": "{\"Version\":\"2019-10-30\",\"StartAction\":\"73611771-2716-4560-afb3-bae51560752c\",\"Metadata\":{\"entryPointPosition\":{\"x\":68,\"y\":115},\"snapToGrid\":false,\"ActionMetadata\":{\"ef747366-46cb-4d97-a096-dd34af2a807f\":{\"position\":{\"x\":578,\"y\":145}},\"73611771-2716-4560-afb3-bae51560752c\":{\"position\":{\"x\":256,\"y\":113},\"useDynamic\":false}}},\"Actions\":[{\"Identifier\":\"ef747366-46cb-4d97-a096-dd34af2a807f\",\"Parameters\":{},\"Transitions\":{},\"Type\":\"EndFlowExecution\"},{\"Identifier\":\"73611771-2716-4560-afb3-bae51560752c\",\"Parameters\":{\"Text\":\"$.Queue.Name\"},\"Transitions\":{\"NextAction\":\"ef747366-46cb-4d97-a096-dd34af2a807f\",\"Errors\":[],\"Conditions\":[]},\"Type\":\"MessageParticipant\"}]}"
}
```

The only flow that acts differently is the ACME_Main flow because we need to refer to the mapping Lambda by its ARN. The developer will remove the ARN from the flow and replace it with "ARNREPLACE". During the deployment process the ARN for the specific instance is inserted back into the flow via a Lambda that works to provision the flows into Amazon Connect.

## Limitations
1. If your solution uses multiple Lambda functions, then you will need to insert a Set contact attributes definition.  This will move the mapping variables from the external memory space to the user memory space.  This is required because the next Lambda function that runs will overwrite the external memory space.  For the purposes of this Workshop, it wasn't necessary. The Set contact attributes definition will look like this:
    - ![[set-contact-attributes.png]](images/set-contact-attributes.png)
1. ACME_customer_queue is a [Customer queue flow](https://docs.aws.amazon.com/connect/latest/adminguide/create-contact-flow.html) that contains a [Loop prompts definition](https://docs.aws.amazon.com/connect/latest/adminguide/contact-block-definitions.html). This definition does not support dynamic attributes so it's deployed with only a text prompt. In reality, you will add an audio prompt after the flow has been deployed.
1. This solution only supports one [AWS Region](https://aws.amazon.com/about-aws/global-infrastructure/regions_az/).  The next version will include Multi-Region support.  This is required for [Amazon Connect Global Resiliency](https://docs.aws.amazon.com/connect/latest/adminguide/setup-connect-global-resiliency.html).

## Prerequisites

- Four [AWS accounts](https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-creating.html)
    - Tooling
    - Develop, Stage, and Production
- [AdministratorAccess](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_job-functions.html) to each AWS account
- [AWS Cloud Development Kit (CDK) v2](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html)
- [AWS Command Line Interface (AWS CLI) v2](https://aws.amazon.com/cli/)
- [Node.js and NPM](https://nodejs.org/en/)
- [GitHub account](https://github.com/).  You only need the Free version.  You will fork this repository and create a Webhook.

### AWS Cloud9
You can use [AWS Cloud9](https://aws.amazon.com/cloud9/) to run this workshop.  AWS CDK, AWS CLI, Node.js and NPM will be installed if you execute these steps:
1. Create an AWS Cloud9 instance
    1. Download [cf.yaml](awsCloud9/cf.yaml).  This is an [AWS CloudFormation](https://aws.amazon.com/cloudformation/) template that will configure AWS Cloud9 in an [Amazon Virtual Private Cloud (VPC)](https://aws.amazon.com/vpc/) 
with a public subnet.
    1. Sign in to the AWS Tooling account
    1. Select the AWS CloudFormation service
    1. Create stack, with new resources
    1. Upload a new template file
    1. Choose the file that you downloaded
    1. Select the Next button
    1. Enter a stack name (e.g., CICDConnectWorkshop01Cloud9)
    1. Optionally, change the VpcCIDR
    1. Select the Next button
    1. Select the Next button
    1. Select the Submit button
    1. Wait for the stack to finish
1. Launch AWS Cloud9
    1. Select the AWS Cloud9 service
    1. Select the CICDConnectWorkshop01Cloud9 environment
    1. Select the Open in Cloud9 button
1. Setup AWS Cloud9
    1. Upload [setup.sh](awsCloud9/setup.sh) to /home/ec2-user/environment
    1. Open a terminal in AWS Cloud9 and run these commands:
        1. ```cd ~/environment/```
        1. ```chmod +x setup.sh```
        1. ```./setup.sh```

## AWS and GitHub Configuration Steps
### Develop, Stage, and Production accounts
#### CDK Bootstrap 
1. Run cdk bootstrap in each account.  You can run this command using [AWS CloudShell](https://aws.amazon.com/cloudshell/)
    1. Select the AWS CloudShell service
    1. Run ```cdk bootstrap aws://<account number>/<region>```

#### Create the AWS IAM Roles that will be used by the AWS CodePipelines 
1. Download [pipelineDeploymentRole.yml](pipelineDeploymentRole.yml).  This can be run as an [AWS CloudFormation StackSets](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/what-is-cfnstacksets.html) if you are using [AWS Control Tower](https://aws.amazon.com/controltower/) or as a CloudFormation stack in each account.  This only needs to be run once per account because it supports multiple regions.
    1. Enter a stack name (e.g., CICDConnectWorkshop01PipelineDeploymentRole)
    1. Enter the Tooling [Account Number](https://docs.aws.amazon.com/IAM/latest/UserGuide/console_account-alias.html#FindingYourAWSId) for the pToolingAccountId parameters
    1. Check the "I acknowledge that AWS CloudFormation might create IAM resources with custom names."

### Fork this repository to your GitHub account
[Follow these steps](https://docs.github.com/en/get-started/quickstart/fork-a-repo)

### Clone the forked repository in your IDE (e.g., AWS Cloud9)
1. [Follow these steps to create a personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
1. [Follow these steps to Clone](https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository)

![[cloned-repo.png]](images/cloned-repo.png)

### Create a GitHub connection in the Tooling account
This Github connection is used to authenticate you to the repository.  Please see https://docs.aws.amazon.com/codepipeline/latest/userguide/connections-github.html for additional information.
1. Select the [AWS CodePipeline](https://aws.amazon.com/codepipeline/) service
1. Select Settings and then Connections
1. Select the Create connection button
1. Select GitHub in the Select a Provider section
1. Add a Connection name (e.g., CICDConnectWorkshop01GitHub)
1. Select the Connect to GitHub button
1. Select Install a new app button.  This will take you to the GitHub Confirm access page where you need to provide your credentials.  You will then provide access to the forked repository.
1. Select the Connect button
1. Note the Arn because it will be used in a later step

![[github-connection.png]](images/github-connection.png)

### Update amzconnect-devops-pipelines/env/accountvars.json
1. ```cd ~/environment/cicd-connect-workshop/amzconnect-devops-pipelines/env/```
1. Update the branch field with the branch name that will be associated with each AWS Account.
1. Update the account field with the AWS Account ID for each account.
1. Update the region field to your AWS Regions.  The [AWS Region needs to support Amazon Connect](https://docs.aws.amazon.com/general/latest/gr/connect_region.html).

```
{
    "accounts": [
    {
        "env": "dev",
        "branch": "develop",
        "enabled": true,
        "account": "XXXXXXXXXXXX",
        "region": ["us-east-1", "us-west-2"],
        "app": "ACME"
    },
    {
        "env": "staging",
        "branch": "staging",
        "enabled": true,
        "account": "XXXXXXXXXXXX",
        "region": ["us-east-1"],
        "app": "ACME"
    },
    {
        "env": "prod",
        "branch": "main",
        "enabled": true,
        "account": "XXXXXXXXXXXX",
        "region": ["us-east-1"],
        "app": "ACME"
    }]
}
```

### Update amzconnect-devops-pipelines/env/devops.json
1. Update the account field with the AWS Account ID for the tooling account.
1. Update the region field.
1. Update the codestarArn field with the ARN from the GitHub Connection. 
1. Update the owner field with your Github account alias.
1. Update the email field with your email address.

```
{
    "env": "devops",
    "account": "XXXXXXXXXXXX",
    "region": "us-east-1",
    "codestarArn": "arn:aws:codestar-connections:us-east-1:XXXXXXXXXXXX:connection/XXXXXX",
    "repo": "cicd-connect-workshop",
    "owner": "Github account alias",
    "email": "youremail@company.com"
}
```

### Push the modified files to your repository's main branch
1. ```cd ~/environment/cicd-connect-workshop/```
1. ```git add --all```
1. ```git commit -m "Updated configuration files"```
1. ```git push```

![[PipelineConfigPush.png]](images/PipelineConfigPush.png)

### Deploy the CodePipelines
1. ```cd ~/environment/cicd-connect-workshop/```
1. ```cdk bootstrap aws://<Tooling account number>/<region> --profile default```
    - You need to run this command since this is the first time you are deploying a CDK application.  See https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html for additional information.
1. ```cd ~/environment/cicd-connect-workshop/amzconnect-devops-pipelines/```
1. ```npm install```
1. ```npm run build```
1. ```cdk deploy --all --profile default```
    - Do you wish to deploy these changes (y/n)? y 

These steps created the CodePipelines (four for each environment) and supporting services.  It also created an [Amazon API Gateway](https://aws.amazon.com/api-gateway/) Lambda function that will be used by the [GitHub Webhook](https://docs.github.com/en/developers/webhooks-and-events/webhooks/about-webhooks).  The URL is in the output section.  See CICDStack.githubRouterApiPayloadUrl.  This will be created in the next step. 

![[DeployedPipelines.png]](images/DeployedPipelines.png)
![[CICDStackOutput.png]](images/CICDStackOutput.png)

### Create a GitHub Webhook
1. Navigate to the Settings menu for your forked repository in GitHub.
1. Select Webhooks.
1. Select Add webhook button.
1. Enter the API Gateway URL that was created in the previous step in the Payload URL field.
1. Select application/json for the Content type field.
1. Enter a secret in the Secret field.  Remember this because you will need it in the next step.
1. Select the Add webhook button.

![[GitHubWebhook.png]](images/GitHubWebhook.png)

### Add the GitHub Webhook secret to AWS Secrets Manager
1. Select the [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/) service.
1. Select githubWebhookSecret secret.
1. Select Retrieve secret value button in the Secret value section.
1. Select Plaintext and then the Edit button.
1. Enter your secret from the previous section.
1. Select the Save button.

![[SecretsManager.png]](images/SecretsManager.png)

## Run the individual pipelines in each environment
These steps will use the Develop environment.  It's the same process for Stage and Production.

### Create a develop branch
The branch name is the value you provided in the cicd-connect-workshop/amzconnect-devops-pipelines/env/accountvars.json branch field.
- ```cd ~/environment/cicd-connect-workshop/```
- ```git checkout -b develop```
    - The -b flag creates the branch.  If the branch is already created then you can remove this flag.

### Create an Amazon Connect instance using the amzconnect-instance-develop CodePipeline
1. Modify /cicd-connect-workshop/amzconnect-instance/lib/instance-stack/configuration.json
    - Provide a instanceAlias and instanceStorageBucketName.  These needs to be globally unique and follow the naming rules.  
    - An [AWS Step Function](https://aws.amazon.com/step-functions/) will run.  The Step Functions will append dev/staging/prod to whatever you use here to make sure that they are different from each other.  The config file will also configure the instance storage requirements as well as two queues which we need for our test flows to work. 

```
{
  "instanceAlias": "mytestalias-aaazzz",
  "instanceStorageBucketName": "connect-aaazzz",
}
```  

2.  Modify /cicd-connect-workshop/amzconnect-instance/env/devops.json
    - Provide the AWS Region and AWS Account ID for the Tooling account.
```
{
    "account": "XXXXXXXXXXXX",
    "region": "us-east-1"
}
```

3. Push the modified files to your repository's develop branch
- ```cd ~/environment/cicd-connect-workshop/amzconnect-instance/```
- ```git add --all```
- ```git commit -m "Updated configuration files"```
- ```git push --set-upstream origin develop```

![[amzconnect-instance-repo-update.png]](images/amzconnect-instance-repo-update.png)

4. The amzconnect-instance-develop pipeline will now start to build the Amazon Connect instance.  Follow these step to verify that the pipeline was successful:
    - Select the AWS CodePipeline service.
    - Select Pipeline and then Pipelines in the menu.
    - This pipeline will show Succeeded in the Most recent execution column. 

![[CodePipeline-instance]](images/CodePipeline-instance.png)

### Create all the supporting infrastructure (e.g., Amazon Lex) except for the Lambda functions 
1. Modify /cicd-connect-workshop/amzconnect-supporting-infra/env/devops.json
    - Provide the AWS Region and AWS Account ID for the Tooling account.
```
{
    "account": "XXXXXXXXXXXX",
    "region": "us-east-1"
}
```

2. Push the modified files to your repository's develop branch
- ```cd ~/environment/cicd-connect-workshop/amzconnect-supporting-infra/```
- ```git add --all```
- ```git commit -m "Updated configuration files"```
- ```git push --set-upstream origin develop```

3. The amzconnect-supporting-infra-develop pipeline will now start to build the supporting infrastructure.  Follow these step to verify that the pipeline was successful:
    - This pipeline will show Succeeded in the Most recent execution column. 

![[CodePipeline-infra]](images/CodePipeline-infra.png)

### Create the Lambda Functions
This code will create all of the necessary Lambda functions. This pipeline also has an area where you could run various unit, integration, or code coverage tests.

1. Modify /cicd-connect-workshop/amzconnect-lambdas/devops.json
    - Provide the AWS Region and AWS Account ID for the Tooling account.
```
{
    "account": "XXXXXXXXXXXX",
    "region": "us-east-1"
}
```

2. Push the modified files to your repository's develop branch
- ```cd ~/environment/cicd-connect-workshop/amzconnect-lambdas/```
- ```git add --all```
- ```git commit -m "Updated configuration files"```
- ```git push --set-upstream origin develop```

3. The amzconnect-lambdas-develop pipeline will now start to build the Lambda functions.  Follow these step to verify that the pipeline was successful:
    - This pipeline will show Succeeded in the Most recent execution column. 

![[CodePipeline-lambda]](images/CodePipeline-lambda.png)

### Deploy the Contact Flows
This code will deploy the contact flows. This pipeline operates a little differently in that we are not deploying any code using CDK. We are using [AWS CodeBuild](https://aws.amazon.com/codebuild/) to copy the contact flows into our contact flow bucket, and then starting the callflowProvisioner Lambda function which will take care of the rest of the configuration.

1. Modify /cicd-connect-workshop/amzconnect-contact-flows/devops.json
    - Provide the AWS Region and AWS Account ID for the Tooling account.
```
{
    "account": "XXXXXXXXXXXX",
    "region": "us-east-1"
}
```

2. Push the modified files to your repository's develop branch
- ```cd ~/environment/cicd-connect-workshop/amzconnect-contact-flows/```
- ```git add --all```
- ```git commit -m "Updated configuration files"```
- ```git push --set-upstream origin develop```

3. The amzconnect-contact-flows-develop pipeline will now start to deploy the contact flows.  Follow these step to verify that the pipeline was successful:
    - This pipeline will show Succeeded in the Most recent execution column. 

![[CodePipeline-contactflows]](images/CodePipeline-contactflows.png)

#### Additional Details
- The Amazon Connect stack has been deployed whose main components consist of an S3 bucket for Contact Flow storage, three Lambda functions, a Lex bot, and Contact Flows that have been deployed to the instance. One of the Lambda functions is the mapping function which maps the unique attribute name to the ARN, and the second function is the Contact Flow Provisioner. During the build phase, the provisioner makes calls to various services to validate the Contact Flows on the instance, retrieve the ARNs for the Lex bot(s), prompts and queues and ultimately packages all of that up and updates the mapping Lambda function.

- Lambda functions and Lex bots specifically need to be granted permission to be called by Connect so there is a custom resource that attaches them to Amazon Connect as well.

#### How to Deploy Contact Flows
- The contact flows are in /cicd-connect-workshop/amzconnect-contact-flows/lib/callflows. The format of each flow looks similar to below:

```
{
    "Name": "ACME_agent_whisper",
    "ContactFlowType": "AGENT_WHISPER",
    "Content": "{\"Version\":\"2019-10-30\",\"StartAction\":\"73611771-2716-4560-afb3-bae51560752c\",\"Metadata\":{\"entryPointPosition\":{\"x\":68,\"y\":115},\"snapToGrid\":false,\"ActionMetadata\":{\"ef747366-46cb-4d97-a096-dd34af2a807f\":{\"position\":{\"x\":578,\"y\":145}},\"73611771-2716-4560-afb3-bae51560752c\":{\"position\":{\"x\":256,\"y\":113},\"useDynamic\":false}}},\"Actions\":[{\"Identifier\":\"ef747366-46cb-4d97-a096-dd34af2a807f\",\"Parameters\":{},\"Transitions\":{},\"Type\":\"EndFlowExecution\"},{\"Identifier\":\"73611771-2716-4560-afb3-bae51560752c\",\"Parameters\":{\"Text\":\"$.Queue.Name\"},\"Transitions\":{\"NextAction\":\"ef747366-46cb-4d97-a096-dd34af2a807f\",\"Errors\":[],\"Conditions\":[]},\"Type\":\"MessageParticipant\"}]}"
}
```

- An easy way to get the content value of a flow after developing one is to use the AWS CLI. All flows on an instance can be listed using the [list-contact-flows command](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/connect/list-contact-flows.html) which will give you the flows and their unique contact-flow-id
```
aws connect list-contact-flows --instance-id <value>
```
To [describe](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/connect/describe-contact-flow.html) a particular flow:
```
aws connect describe-contact-flow --instance-id <value> --contact-flow-id <value>
```
Example output: 
```
{
    "ContactFlow": {
        "Arn": "arn:aws:connect:us-east-1:XXXXXXXXXXXX:instance/34ed4674-e1c9-43ee-880d-XXXXXXXXXXXX/contact-flow/a318e3af-f88e-45e0-88ac-35808a898b52",
        "Id": "a318e3af-f88e-45e0-88ac-XXXXXXXXXXXX",
        "Name": "Default agent whisper",
        "Type": "AGENT_WHISPER",
        "State": "ACTIVE",
        "Description": "Default whisper played to the agent.",
        "Content": "{\"Version\":\"2019-10-30\",\"StartAction\":\"222caecc-c107-4553-87fc-85a74c34bb06\",\"Metadata\":{\"entryPointPosition\":{\"x\":75,\"y\":20},\"snapToGrid\":false,\"ActionMetadata\":{\"95dc2179-0f18-4646-8e15-15377c9cbb29\":{\"position\":{\"x\":491.0034484863281,\"y\":141.5555419921875}},\"222caecc-c107-4553-87fc-85a74c34bb06\":{\"position\":{\"x\":231.00344848632812,\"y\":96.5555419921875},\"useDynamic\":false}}},\"Actions\":[{\"Identifier\":\"95dc2179-0f18-4646-8e15-15377c9cbb29\",\"Parameters\":{},\"Transitions\":{},\"Type\":\"EndFlowExecution\"},{\"Identifier\":\"222caecc-c107-4553-87fc-85a74c34bb06\",\"Parameters\":{\"Text\":\"$.Queue.Name\"},\"Transitions\":{\"NextAction\":\"95dc2179-0f18-4646-8e15-15377c9cbb29\",\"Errors\":[],\"Conditions\":[]},\"Type\":\"MessageParticipant\"}]}",
        "Tags": {}
    }
}
```

## Test the solution
1. To test that the solution works, we need to get into Amazon Connect, claim a phone number and attach it to the ACME_Main flow. The example shows a US DID, however choose whatever works for you.

![[claim-number.png]](images/claim-number.png)

2. Call the phone number that you claimed.  The contact flow will ask you what department do you need to speak to? 
