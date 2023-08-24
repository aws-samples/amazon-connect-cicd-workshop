/* eslint-disable @typescript-eslint/no-non-null-assertion*/
import { CodePipelineClient, StartPipelineExecutionCommand } from "@aws-sdk/client-codepipeline";
import { SecretsManagerClient, GetSecretValueCommand, GetSecretValueCommandOutput } from "@aws-sdk/client-secrets-manager";

import { APIGatewayProxyHandler } from 'aws-lambda'; 
import * as path from 'path';
import middy from '@middy/core';
import { Logger, injectLambdaContext } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import crypto from "crypto";
// import { StringAttribute } from "aws-cdk-lib/aws-cognito";

// Set environment variables, tracing, and logging
const tracer = new Tracer({ serviceName: 'githubRouter' });
const logger = new Logger({ logLevel: 'INFO', serviceName: 'githubRouter' });
const region = process.env.AWS_REGION
const secretArn = process.env.SECRET_ARN!


// Initialize Clients

const client = tracer.captureAWSv3Client(new CodePipelineClient({ region: region }));
const secretClient = tracer.captureAWSv3Client(new SecretsManagerClient({ region: region }));


// Function to get SSM paramter
// const getSecret = async (secretArn: string) => {
async function getSecret (secretArn: string): Promise<GetSecretValueCommandOutput> {
    const secretCommand = new GetSecretValueCommand({
        SecretId: secretArn,
    });
    console.log(`>>> Getting ${secretArn} from Secrets Manager ....`)
    const response = await secretClient.send(secretCommand);
    return response
}

// Function to start a pipeline

async function startPipelineExecution(pipelineName: string) {
    const cpCommand =  new StartPipelineExecutionCommand({
        name: pipelineName
    })
    const cpResponse = await client.send(cpCommand);
    const cpReturn = {
        "isBase64Encoded": false,
        "statusCode": 200,
        "body": JSON.stringify({"pipelineExecutionId": cpResponse.pipelineExecutionId})
    } 
    logger.info('Response: ', cpReturn)
    return cpReturn
}

const lambdaHandler: APIGatewayProxyHandler = async (event , context) => { // eslint-disable-line @typescript-eslint/no-unused-vars
// const lambdaHandler= async (event: Event , context: Context): Promise<void> => { 
    // Parse event body to get branch

    const eventBody = JSON.parse(event["body"]!)
    const branch = eventBody.ref.split('/')

    const githubSecret = await getSecret(secretArn)
    
    // Authenticate Github request using SHA256 signature against body of message

    const derivedSig = crypto.createHmac("sha256", githubSecret.SecretString!).update(event.body!).digest("hex");
    console.log(derivedSig)

    const isSignatureValid = (body: string, signature256: string): boolean =>
        signature256 === `sha256=${derivedSig}`;

    const signature256 = event.headers["X-Hub-Signature-256"];


    if (!isSignatureValid(event.body!, signature256!)) {
        console.error("Signature from headers could not be validated against secret");
        const response = {
            'statusCode': 400,
            'message': "Invalid signature"
        }
        logger.error(response)
        // return response;
        return {
            'statusCode': 200,
            'body': JSON.stringify({message: response})
        }
    } else {
        logger.info("Signatures matched")
        //  If signatures match, start pipeline
        // let directoryName = ''
        // let directoryList = [];

        if (eventBody["head_commit"]["modified"][0]) {
            const dirSet = new Set()
            for (const file of eventBody["head_commit"]["modified"]) {
                console.log("modified files:", eventBody["head_commit"]["modified"])
                const directoryName = path.dirname(file).split(path.sep)
                // if (directoryName[0] != 'amzconnect-devops-pipelines' || ".")
                dirSet.add(directoryName[0])
                try {
                    dirSet.delete('amzconnect-devops-pipelines')
                    dirSet.delete('.')
                } catch (error) {
                    logger.error("Error removing amzconnect-devops-pipelines from set", error as Error)
                }
            }
            // console.log(dirSet)
            console.log('parent directories :',[...dirSet])
            for (const setMem of [...dirSet]) {
            console.log(`starting pipeline: ${setMem}-${branch[2]}`);
            await startPipelineExecution(`${setMem}-${branch[2]}`)     
            }
        } else if (eventBody["head_commit"]["added"][0]) {
            const dirSet = new Set()
            for (const file of eventBody["head_commit"]["added"]) {
                console.log("modified files:", eventBody["head_commit"]["modified"])
                const directoryName = path.dirname(file).split(path.sep)
                dirSet.add(directoryName[0])
                try {
                    dirSet.delete('amzconnect-devops-pipelines')
                    dirSet.delete('.')
                } catch (error) {
                    logger.error("Error removing amzconnect-devops-pipelines from set", error as Error)
                }
            }
            // console.log(dirSet)
            console.log('parent directories :',[...dirSet])
            if (dirSet.size === 0) {
                console.log('>>> Nothing to deploy. Exiting ...')
            }
            for (const setMem of [...dirSet]) {
            console.log(`starting pipeline: ${setMem}-${branch[2]}`);
            await startPipelineExecution(`${setMem}-${branch[2]}`)     
            }
        } else {
            logger.info("No files changed")
        }
    
        return {
            'statusCode': 200,
            'body': JSON.stringify({message: "Success"})
        }
    } 

}

export const handler = middy(lambdaHandler)
    .use(injectLambdaContext(logger, { logEvent: true }));
