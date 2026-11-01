#!/usr/bin/env node
// node scripts/create-delivery.mjs PUBLIC_KEY TEMP_PLAINTEXT ENCRYPTED_OUTPUT
// Only the encrypted output belongs in GitHub. No receiving private key is needed.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,basename} from 'node:path';
import '../assistant-inbox-core.js';
const core=AssistantInboxCore('coffee');
const [keyPath,inputPath,outputPath]=process.argv.slice(2);
if(!keyPath||!inputPath||!outputPath){console.error('Usage: node scripts/create-delivery.mjs PUBLIC_KEY TEMP_PLAINTEXT ENCRYPTED_OUTPUT');process.exit(1);}
try {
  const keyFile=JSON.parse(await readFile(keyPath,'utf8'));
  const payload=JSON.parse(await readFile(inputPath,'utf8'));
  const envelope=await core.encryptDelivery(keyFile,payload);
  if(basename(outputPath)!==envelope.id+'.json')throw Error('Output filename must be the delivery UUID followed by .json.');
  await mkdir(dirname(outputPath),{recursive:true});
  await writeFile(outputPath,JSON.stringify(envelope,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Encrypted batch prepared: '+payload.entries.length+' entries. Commit only the output envelope to inbox/.');
}catch(e){console.error(e.message);process.exitCode=1;}

