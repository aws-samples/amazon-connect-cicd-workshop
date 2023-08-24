### Connect Automation using CDK Pipelines and TypeScript #
 

This project will deploy Amazon Connect contact flows using multi-account pipelines.

In Connect deployments it is common to deploy contact flows that are created in the console which refer to the various objects such as queues, prompts, lambda functions, Lex bots, etc., by name (translated to ARN) or ARN. This works great in a single account, however it becomes an issue when you need to move those flows between instances in different accounts. All object (ARNs) from the source instance need to be mapped one to one to the destination instance. This becomes unwieldy when you have multiple instances and large numbers of flows as well as introducing human error into the equation.
This artifact aims to push an alternate design forward where all objects are not referred to by ARN but by an attribute name instead. On the initial flow that a call comes into (ACME_Main in our case) there is a mapping lambda that runs which has an entry for all possible objects that one could encounter within a particular Connect instance and maps those objects to the corresponding ARN. These attributes are held within memory so that when an object is referenced by a unique name, the ARN is already known so that the object can be accessed. 

So how does this work in practice? First a contact flow developer creates flows as normal but when referencing an object such as a Lex bot, instead of using the ARN, references an attribute name which needs to be unique within the instance.

![image: lexbot-attribute.png](images/lexbot-attribute.png)

Or for instance a queue works in the same manner.

![image: queue-attribute.png](images/queue-attribute.png)

These flows are then exported from an Amazon Connect flow development instance (this could still be the development instance) and added into the repository under lib/callflows. 

Each flow will look something like this  --

```
{
    "Name": "ACME_agent_whisper",
    "ContactFlowType": "AGENT_WHISPER",
    "Content": "{\"Version\":\"2019-10-30\",\"StartAction\":\"73611771-2716-4560-afb3-bae51560752c\",\"Metadata\":{\"entryPointPosition\":{\"x\":68,\"y\":115},\"snapToGrid\":false,\"ActionMetadata\":{\"ef747366-46cb-4d97-a096-dd34af2a807f\":{\"position\":{\"x\":578,\"y\":145}},\"73611771-2716-4560-afb3-bae51560752c\":{\"position\":{\"x\":256,\"y\":113},\"useDynamic\":false}}},\"Actions\":[{\"Identifier\":\"ef747366-46cb-4d97-a096-dd34af2a807f\",\"Parameters\":{},\"Transitions\":{},\"Type\":\"EndFlowExecution\"},{\"Identifier\":\"73611771-2716-4560-afb3-bae51560752c\",\"Parameters\":{\"Text\":\"$.Queue.Name\"},\"Transitions\":{\"NextAction\":\"ef747366-46cb-4d97-a096-dd34af2a807f\",\"Errors\":[],\"Conditions\":[]},\"Type\":\"MessageParticipant\"}]}"
}
```

The only flow that acts somewhat differently is the MAIN flow because  we need to refer to the mapping lambda by its ARN. The developer would remove the ARN from the flow and replace it with "ARNREPLACE". During the initial deployment process the ARN is inserted back into the flow via a lambda that works to provision the flows onto Connect.

## Architecture

![image: architecture.png](images/architecture.png)

## Prerequisites

- Four AWS accounts - One serves as a tooling account while the others are for Develop, Staging, and Production
- Amazon Connect instance fully configured in each environment account with associated queues (ACME_Sales and ACME_Finance), hours of operation, phone numbers, and routing profiles preconfigured.
- latest version of CDKv2 installed
- npm installed
- NodeJs


 ## Limitations

  - This is a POC to show the design components of how one would approach deploying Amazon Connect contact flows and not about deploying the Amazon Connect service itself. Additionally, in practice, it might be necessary to move from the opinionated cdk pipelines construct to something purpose-built for the environment you are operating within.
  - In a larger deployment with multiple lambdas, there will need to be a manual step inserted after the initial mapping lambda runs to map the attributes to a user defined type from external. This precludes the next lambda from overwriting the  external memory space. For the purposes of this POC, it wasn't necessary. The contact attributes block would look something like this:
  - ![image: set-contact-attributes.png](images/set-contact-attributes.png)
  

## Pre-deployment Steps -git a

  - We will be using the modern version of [CDK pipelines](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.pipelines-readme.html) to deploy our contact flows. As such we will need to bootstrap our tooling account and our SDLC accounts. To do this we need the account id from all accounts as well as the region that you wish to deploy into.

 
For tooling:

``` cdk bootstrap --bootstrap-customer-key --cloudformation-execution-policies 'arn:aws:iam::aws:policy/AdministratorAccess' aws://111111111111/us-east-1```

**Note** replace aws://111111111111/us-east-1 with your actual tooling account id and region

For the SDLC accounts (Develop, Staging, Production), the example below assumes that you are using profiles -

``` cdk bootstrap --bootstrap-customer-key --cloudformation-execution-policies 'arn:aws:iam::aws:policy/AdministratorAccess' --trust 111111111111 aws://222222222222/us-east-1 --profile <your profile name here>```

  **Note** replace '--trust 111111111111 aws://222222222222/us-east-1' with your actual tooling account id and environment account id and region

 Repeat the same process above for Staging and Production.

  

## Steps to Deploy

- Clone the repository from Gitlab

  ``` git clone git@ssh.gitlab.aws.dev:jasoown/connect-automation-with-multi-account-ci-cd.git```

- cd into repo, and then navigate to env directory. Adjust the devops.json file with the account number and region in with the info of the DevOps account. Next, navigate to accountvars.json and do the same for  all of the environment accounts, but also make sure to add the instance id of the connect instance deployed into each of those accounts. Finally, if using git-defender, add the accounts into .gitignore.

- ```npm install```
- ```npm run build```
- ```cdk deploy```

At this point the pipelines have all been created, but the initial execution failed due to there not being any code into CodeCommit yet.

- Add a git remote for CodeCommit
    ```git remote add cc https://git-codecommit.us-east-1.amazonaws.com/v1/repos/connect-automation```
- Create a branch in your local repo for develop
    ```git checkout -b develop```
- Push code to the develop branch.
    ```git push --set-upstream cc develop```

The development pipeline will now start and deploy the contact flows to the development instance of Amazon Connect. Once complete we need to repeat the steps above for staging and prod.

- Create a branch in your local repo for staging
    ```git checkout -b staging```
- Push code to the staging branch.
    ```git push --set-upstream cc staging```
- Checkout the main branch.
    ```git checkout main```
- Push code to the main branch.
    ```git push --set-upstream cc main```

After the pipelines have run, you should now have Connect instances with working contact flows in them.

## Connect 

We will now go through what it is that we have deployed and how it all works.

- The connect stack has been deployed whose main components consist of an S3 bucket for contact flow storage, two lambda functions,  a Lex bot, and  contact flows that have been deployed to the instance. One of the lambda functions is the mapping function which maps the unique attribute name to the ARN, and the second function is the contact flow provisioner. During the build phase, the provisioner makes calls to various services to validate the contact flows on the instance, retrieve the ARNS for the Lex bot(s), prompts and queues and ultimately packages all of that up and updates the mapping lambda.

- Lambda functions and Lex bots specifically need to be granted permission to be called by Connect so there is a custom resource that attaches them to Connect as well.

## How to Deploy Contact Flows

- The provisionerLambda is watching for changes to /env/callfows.json. If this file is different in any way from a previous run it will trigger the lambda to run and redeploy all contact flows.
- The contact flows are in /lib/callflows. The format of each flow looks like this:```

```
{

    "Name": "ACME_agent_whisper",
    "ContactFlowType": "AGENT_WHISPER",
    "Content": "{\"Version\":\"2019-10-30\",\"StartAction\":\"73611771-2716-4560-afb3-bae51560752c\",\"Metadata\":{\"entryPointPosition\":{\"x\":68,\"y\":115},\"snapToGrid\":false,\"ActionMetadata\":{\"ef747366-46cb-4d97-a096-dd34af2a807f\":{\"position\":{\"x\":578,\"y\":145}},\"73611771-2716-4560-afb3-bae51560752c\":{\"position\":{\"x\":256,\"y\":113},\"useDynamic\":false}}},\"Actions\":[{\"Identifier\":\"ef747366-46cb-4d97-a096-dd34af2a807f\",\"Parameters\":{},\"Transitions\":{},\"Type\":\"EndFlowExecution\"},{\"Identifier\":\"73611771-2716-4560-afb3-bae51560752c\",\"Parameters\":{\"Text\":\"$.Queue.Name\"},\"Transitions\":{\"NextAction\":\"ef747366-46cb-4d97-a096-dd34af2a807f\",\"Errors\":[],\"Conditions\":[]},\"Type\":\"MessageParticipant\"}]}"

}
```

- An easy way to get the content value of a flow after developing one is to use the aws cli. All flows on an instance can be listed by the following [command](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/connect/list-contact-flows.html) which will give you the flows and their unique contact-flow-id
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
        "Arn": "arn:aws:connect:us-east-1:251778280686:instance/34ed4674-e1c9-43ee-880d-3a5c242913cd/contact-flow/a318e3af-f88e-45e0-88ac-35808a898b52",
        "Id": "a318e3af-f88e-45e0-88ac-35808a898b52",
        "Name": "Default agent whisper",
        "Type": "AGENT_WHISPER",
        "State": "ACTIVE",
        "Description": "Default whisper played to the agent.",
        "Content": "{\"Version\":\"2019-10-30\",\"StartAction\":\"222caecc-c107-4553-87fc-85a74c34bb06\",\"Metadata\":{\"entryPointPosition\":{\"x\":75,\"y\":20},\"snapToGrid\":false,\"ActionMetadata\":{\"95dc2179-0f18-4646-8e15-15377c9cbb29\":{\"position\":{\"x\":491.0034484863281,\"y\":141.5555419921875}},\"222caecc-c107-4553-87fc-85a74c34bb06\":{\"position\":{\"x\":231.00344848632812,\"y\":96.5555419921875},\"useDynamic\":false}}},\"Actions\":[{\"Identifier\":\"95dc2179-0f18-4646-8e15-15377c9cbb29\",\"Parameters\":{},\"Transitions\":{},\"Type\":\"EndFlowExecution\"},{\"Identifier\":\"222caecc-c107-4553-87fc-85a74c34bb06\",\"Parameters\":{\"Text\":\"$.Queue.Name\"},\"Transitions\":{\"NextAction\":\"95dc2179-0f18-4646-8e15-15377c9cbb29\",\"Errors\":[],\"Conditions\":[]},\"Type\":\"MessageParticipant\"}]}",
        "Tags": {}
    }
}
```


## Useful commands

  

* `npm run build`   compile typescript to js

* `npm run watch`   watch for changes and compile

* `npm run test`    perform the jest unit tests

* `cdk deploy`      deploy this stack to your default AWS account/region

* `cdk diff`        compare deployed stack with current state

* `cdk synth`       emits the synthesized CloudFormation template