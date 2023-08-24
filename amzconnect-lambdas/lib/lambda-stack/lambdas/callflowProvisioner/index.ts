import { ConnectClient, ListContactFlowsCommand, CreateContactFlowCommand, UpdateContactFlowContentCommand, UpdateContactFlowNameCommand, ListPromptsCommand, ListQueuesCommand } from "@aws-sdk/client-connect";
import { SSMClient, PutParameterCommand, GetParameterCommand } from "@aws-sdk/client-ssm";
import { S3Client, ListObjectsV2Command,  GetObjectCommand,  } from "@aws-sdk/client-s3";
import { LexModelsV2Client, ListBotsCommand, ListBotAliasesCommand } from "@aws-sdk/client-lex-models-v2";
import { LambdaClient, UpdateFunctionCodeCommand } from "@aws-sdk/client-lambda";
import { Readable } from "stream";
import { Upload } from "@aws-sdk/lib-storage";
import fs from 'fs';
// import * as path from 'path';
import JSZip from "jszip"
import { Context } from 'aws-lambda';
import middy from '@middy/core';
import { Logger, injectLambdaContext } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import {js_beautify} from 'js-beautify';

// Environment Variables  
const region = process.env.AWS_REGION
const instanceId = process.env.CONNECT_INSTANCEID
const env = process.env.FUNCTION_ENV
const app = process.env.FUNCTION_APP
const account = process.env.FUNCTION_ACCOUNT
const bucketName = process.env.BUCKET
const tracer = new Tracer({ serviceName: 'provisioner' });
const logger = new Logger({ logLevel: 'INFO', serviceName: 'provisioner' });

// Initialize Clients
const s3client = tracer.captureAWSv3Client(new S3Client({ region: region }));
const client = tracer.captureAWSv3Client(new ConnectClient({ region: region }));
const ssmclient = tracer.captureAWSv3Client(new SSMClient({ region: region }));
const lexclient = tracer.captureAWSv3Client(new LexModelsV2Client({ region: region }));
const lambdaclient = tracer.captureAWSv3Client(new LambdaClient({ region: region }));

async function streamToString(stream: Readable) {
    // lets have a ReadableStream as a stream variable
    const chunks = [];

    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString("utf-8");
}

const createSsmParam = async (paramName: string, paramValue: string) => {
    const ssmCommand = new PutParameterCommand({
        Name: `/${app}/${env}/${paramName}`,
        Value: `${paramName}: ${paramValue}`,
        Type: "String",
        Overwrite: true
    });
    await ssmclient.send(ssmCommand);
    console.log('SSM Parameter added: ', paramName, `${paramName}: ${paramValue}`)
}

const getSsmParam = async (paramName: string) => {
    const ssmCommand = new GetParameterCommand({
        Name: `/${app}/${env}/${paramName}`,
    });
    console.log(`Getting  /${app}/${env}/${paramName} from SSM ....`)
    const response = await ssmclient.send(ssmCommand);
    console.log('SSM Parameter value: ', response.Parameter.Value);
    return response.Parameter.Value
}
const s3ListObjects = async (bucketName: string) => {
    const s3Command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: 'callflows'
    });
    const s3Response = await s3client.send(s3Command);
    const s3List = s3Response.Contents
    console.log(s3List)
    return s3List
}
// TODO: Change Type to Type (from ContactFlowType) in actual contact flow for consistency

const createContactFlow = async (Name: string, Type: string, Content: string) => {
    const createCommand = new CreateContactFlowCommand({
        Name: Name,
        InstanceId: instanceId,
        Type: Type,
        Content: Content
    });
    await client.send(createCommand);
    logger.info("Adding ", Name)
}


const lambdaHandler = async (_event: unknown, _context: Context): Promise<string> => { // eslint-disable-line @typescript-eslint/no-unused-vars

    //* Get mapping function name and ARN from SSM parameter store

    const ssmGResp: string = await getSsmParam("MappingFunctionArn")
    const ssmGResp2: string = await getSsmParam("MappingFunctionName")
   

        const s3List = await s3ListObjects(bucketName)

        type contactFlowObj = {
            Name: string;
            ContactFlowType: string,
            Content: string;
        };

        const s3Contents = []
        try {
            if (s3List) {
                for (const file of s3List) {
                    const s3GCommand = new GetObjectCommand({
                        Bucket: bucketName,
                        Key: file.Key
                    });

                    const { Body } = await s3client.send(s3GCommand);

                    const bodyContents: string = await streamToString(Body as Readable);
                    logger.info(bodyContents)
                    const bodyContentsNew = bodyContents.replace("<<ARNREPLACE>>", ssmGResp)
                    logger.info(bodyContentsNew)
                    const s3json: contactFlowObj = JSON.parse(bodyContentsNew)
                    s3Contents.push(s3json);
                    const fileName = file.Key
                    console.log(fileName)
                    logger.info(`Retrieved ${fileName} from S3`);
                }
            } else {
                console.log("Response from S3 Get Bucket is empty")
            }
            console.log("Array of File Contents from S3: ")
            console.log(s3Contents)
        } catch (error) {
            logger.error("Error getting flows from S3", error as Error)
            throw error
        }

        const callflows = s3Contents

        //* Get callflows that exist on Connect Instance

        const listCommand = new ListContactFlowsCommand({ InstanceId: instanceId });
        const listResponse = await client.send(listCommand);
        const summaryList = listResponse["ContactFlowSummaryList"]

        //* Map callflows not present on Connect instance
        const cf = callflows.filter((o) => !summaryList.some((i) => i.Name === o.Name));
        const notPresent = cf.map((o) => { return { 'Name': o.Name, "ContactFlowType": o.ContactFlowType, "Content": o.Content } });
        console.log("Flows not present on Connect instance: ")
        console.log(notPresent);

        //* Add flows that were not present to instance

        for (const flow of notPresent) {
            const createCFResponse = await createContactFlow(flow.Name, flow.ContactFlowType, flow.Content)
            console.log(createCFResponse)
        }

        //* Retrieve all flows that match app name. This now includes and contact flow that we just added.

        const listResponse2 = await client.send(listCommand)
        const summaryList2 = listResponse2["ContactFlowSummaryList"]

        const appFlows = summaryList2.filter((o) => o.Name.startsWith(`${app}`))
        console.log("All flows on Connect instance that are prefixed with App name")
        console.log(appFlows)

        //* Map callflows on Connect instance not present in S3 (orphaned callfows). Future functionality to delete.

        const orphanedFlows = appFlows.filter((o) => !callflows.some((i) => i.Name === o.Name));
        // const orphanedFlows = cf2.map((o: any) => { return { 'Name': o.Name, "ContactFlowType": o.ContactFlowType } });
        console.log("Orphaned Flows on Connect instance that match app name but not present in S3/Source Repository: ")
        console.log(orphanedFlows);

        //* Map all callflows from appflows, but without orphaned flows (i.e matching the items in callflows array). The reason we need to do
        //* this is because the items in the callflows array don't have the callflow ID which we need to do an update
        const appFlows2 = appFlows.filter((o) => callflows.some((i) => i.Name === o.Name));
        console.log("appFlows2", appFlows2)

        //* Start writing the mapping function
        const mapperFile = [];
        const mapperArray = [];
     
        //* Get Lex alias arns to add to SSM
        try {
            //* Get list of bots and filter them by name
            const lexList = new ListBotsCommand({});
            const lexResp = await lexclient.send(lexList);
            const llsum = lexResp.botSummaries
            const lexRespFilter = llsum.filter((o) => o.botName.startsWith(`${app}`))
            console.log("Lex bots that match App name :", lexRespFilter)
            //* Loop through filtered list and get aliases assigned to them
            for (const bot of lexRespFilter) {
                const lbac = new ListBotAliasesCommand({
                    botId: bot.botId
                });
                const lbacResp = await lexclient.send(lbac);
                const _lbac = lbacResp.botAliasSummaries
                console.log("Lex bot aliases that match the environment name from bots that match App name :", _lbac)
                const lbacRespList = _lbac.filter((o) => o.botAliasName === `${env}`);
                const lbacRespListMap = lbacRespList.map((i) => { return i.botAliasId });
                // Construct Arn to add to SSM and add it.
                const lbArn = `arn:aws:lex:${region}:${account}:bot-alias/${bot.botId}/${lbacRespListMap[0]}`
                await createSsmParam(bot.botName, lbArn);
                mapperArray.push(`"${bot.botName}": "${lbArn}",`);
            }
        } catch (error) {
            logger.error("Error adding lexbots to file", error as Error)
            throw error
        }
        //*  Get Queues to add to SSM
        try {
            const lqCommand = new ListQueuesCommand({
                InstanceId: instanceId
            });
            const lqResp = await client.send(lqCommand);
            console.log(lqResp)
            for (const p of lqResp.QueueSummaryList.filter((o) => o.Name !== undefined)) {
                mapperArray.push(`"${p.Name}": "${p.Arn}",`);
                // await createSsmParam(p.Name, p.Arn); 
            }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            if (error.message == "Rate exceeded") {
                logger.error("Error adding queues to SSM", error as Error)
            } else {
                logger.error("Error adding queues to file", error as Error)
                throw error
            }
        }

        //*  Get Prompts to add to SSM.
        try {
            const lpCommand = new ListPromptsCommand({
                InstanceId: instanceId
            });
            const lpResp = await client.send(lpCommand);
            for (const p of lpResp.PromptSummaryList) {
                mapperArray.push(`"${p.Name}": "${p.Arn}",`);
            }
        } catch (error) {
            logger.error("Error adding prompts to SSM", error as Error)
            throw error
        }

        //* Add SSM Params for all call flows - using appFlows2
        try {
            for (const flow of appFlows2) {
                await createSsmParam(flow.Name, flow.Arn);
                mapperArray.push(`"${flow.Name}": "${flow.Arn}",`);
            }
        } catch (error) {
            logger.error("Error appending to js file", error as Error)
            throw error
        }

        //* Update all flows from S3 with latest flow content -- changed below from appFlows 9/30/22. it was trying to install flows that
        //* existed on instance however were not in S3.

        try {
            for (const uflow of appFlows2) {
                const flowName = uflow.Name
                const flowId = uflow.Id
                console.log("Flow Name: ", flowName)
                const cfFilter = callflows.filter((o) => o.Name === flowName)
                const flowContent = cfFilter.map((o) => { return o.Content });
                console.log("Flow Content: ", flowContent)
                const updateCommand = new UpdateContactFlowContentCommand({
                    ContactFlowId: flowId,
                    Content: flowContent[0],
                    InstanceId: instanceId
                });
                await client.send(updateCommand)
                console.log('Flow updated: ', flowName)
            }
        } catch (error) {
            logger.error("Error updating contact flows", error as Error)
            throw error
        }

        //* Rename Orphaned flows to have a Z in front of name

        try {
            for (const uflow of orphanedFlows) {
                const flowName = uflow.Name
                const flowId = uflow.Id
                console.log("Flow Name: ", flowName)
                const updateNameCommand = new UpdateContactFlowNameCommand({
                    ContactFlowId: flowId,
                    Name: `z_${flowName}`,
                    Description: "Orphaned Flow",
                    InstanceId: instanceId
                });
                await client.send(updateNameCommand)
                console.log('Flow renamed: ', flowName)
            }
        } catch (error) {
            logger.error("Error renaming flows", error as Error)
            throw error

        }
        //* Create mapper file
        mapperFile.push(`exports.handler =  async (_event) => {`);
        mapperFile.push(`return {`);
        mapperFile.push(mapperArray.join('\n'));
        mapperFile.push(`}`);
        mapperFile.push(`}`);

        const createFile = (file: any[]) => {
            try {
                fs.writeFileSync('/tmp/mappingFile.js', file.join('\n'));
            } catch(error) {
                logger.error("Error creating mappingFile", error as Error)
                throw error
            }           
        }


        createFile(mapperFile)

        // Zip Mapping Function index.js file and upload to S3

        const readFile2 = fs.readFileSync("/tmp/mappingFile.js", "utf8")
        console.log("readfile2: ")
        console.log(readFile2)
        const beautifiedCode = js_beautify(readFile2, {indent_size: 2, space_in_empty_paren: true });
        console.log("beautified: ")
        console.log(beautifiedCode)
        const zip = new JSZip();
        try {
            zip.file("index.js", beautifiedCode);
            zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
                .pipe(fs.createWriteStream('/tmp/index.zip'))
                .on('finish', function () {
                    console.log("zip created");
                });
        } catch (error) {
            logger.error("Error zipping function", error as Error)
            throw error
        }

        const fileStream = fs.createReadStream(`/tmp/index.zip`);

        try {
            const data = new Upload({
                client: s3client,
                params: {
                    Bucket: bucketName,
                    Key: 'index.zip',
                    Body: fileStream,
                }
            });

            data.on("httpUploadProgress", (progress: any) => {
                console.log(progress);
            });
            
            await data.done();
            } catch (e) {
              console.log(e);
            }

        console.log(ssmGResp2, bucketName)
        
        try {
            const lambdaCommand = new UpdateFunctionCodeCommand({
                FunctionName: ssmGResp2,
                Publish: false,
                S3Bucket: bucketName,
                S3Key: 'index.zip'
            });
            // eslint-disable-line @typescript-eslint/no-unused-vars
            const lambdaResponse: any = await lambdaclient.send(lambdaCommand); 
            console.log("Lambda update response")
            logger.info (lambdaResponse)

        } catch (error) {
            logger.error("Error updating Function", error as Error)
            throw error
        }

    logger.info("Provisioning Complete")
    return "Provisioning Complete"
}

export const handler = middy(lambdaHandler)
    .use(injectLambdaContext(logger, { logEvent: true }));