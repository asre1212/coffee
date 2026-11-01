/* Encrypted chat deliveries. Shared validation is also used by the assistant CLI. */
(function (root) {
function createCore(APP) {
  'use strict';
  const SETTINGS = {
    matcha: {repo:'matcha',key:'matcha:journal:v1',empty:[]},
    coffee: {repo:'coffee',key:'coffee-gazette-data-v3',empty:{beans:[],espresso:[],pourover:[],frenchpress:[],notes:''}},
    hotel: {repo:'hotel',key:'hj.hotels.v1',empty:[]}
  };
  if (!Object.hasOwn(SETTINGS,APP)) throw Error('Unknown app.');
  const REPO='asre1212/'+SETTINGS[APP].repo, BRANCH='main';
  const COLLECTION_KEY=SETTINGS[APP].key, CONFIG_KEY=APP+'.assistant.connection.v1';
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SHA=/^[0-9a-f]{40}$/i;
  const METHODS=['espresso','pourover','frenchpress'];
  function string(value,max,label,required=false) {
    if(value==null&&!required)return '';
    if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Error('Invalid '+label+'.');
    return value.trim();
  }
  function numeric(value,max,label) {
    if(value==null||value==='')return null;
    if(!['string','number'].includes(typeof value)||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>max)throw Error('Invalid '+label+'.');
    return Number(value);
  }
  function choice(value,values,fallback,label) {
    if(value==null||value==='')return fallback;
    if(!values.includes(value))throw Error('Invalid '+label+'.');
    return value;
  }
  function validateEntry(x) {
    if(!x||!UUID.test(x.id))throw Error('Each entry needs a unique UUID.');
    const e={id:x.id,name:string(x.name,300,'name',true),rating:numeric(x.rating,5,'rating')};
    if(APP==='matcha') {
      for(const key of ['company','region'])e[key]=string(x[key],300,key);
      e.grade=choice(x.grade,['ceremonial','premium','culinary'],'','grade');
      e.tastingNotes=string(x.tastingNotes,10000,'tasting notes');
      e.notes=string(x.notes,10000,'notes');e.photo='';
      e.createdAt=e.updatedAt=new Date().toISOString();
    } else if(APP==='hotel') {
      e.city=string(x.city,300,'city',true);
      for(const key of ['country','brand'])e[key]=string(x[key],300,key);
      e.notes=string(x.notes,10000,'notes');
      e.status=choice(x.status,['stayed','wishlist'],e.rating===null?'wishlist':'stayed','status');
      if(e.status==='wishlist'&&e.rating!==null)throw Error('Wishlist hotels cannot have ratings.');
      if(x.contacts!=null&&(!Array.isArray(x.contacts)||x.contacts.length>30))throw Error('Invalid contacts.');
      e.contacts=(x.contacts||[]).map(c=>({name:string(c?.name,300,'contact name'),email:string(c?.email,300,'email'),phone:string(c?.phone,100,'phone')}));
      e.photos=[];e.updated=Date.now();
    } else {
      e.method=choice(x.method,METHODS,null,'brew method');
      if(!e.method)throw Error('Specify espresso, pourover, or frenchpress.');
      e.roaster=string(x.roaster,300,'roaster');
      e.roast=choice(x.roast,['light','medium','dark','unspecified'],'unspecified','roast');
      e.caffeine=choice(x.caffeine,['caffeine','decaf','unspecified'],'unspecified','caffeine');
      e.instructions=string(x.instructions,10000,'instructions');
      e.altitude=string(x.altitude,100,'altitude');
      if(x.countries!=null&&(!Array.isArray(x.countries)||x.countries.length>30))throw Error('Invalid countries.');
      e.countries=(x.countries||[]).map(c=>string(c,100,'country',true));
      e.beanId='assistant-bean-'+e.id;
    }
    return e;
  }
  function validatePayload(p) {
    if(p?.version!==1||p.app!==APP||!UUID.test(p.id)||!Array.isArray(p.entries)||!p.entries.length||p.entries.length>500)throw Error('Use a version 1 '+APP+' batch with a UUID and 1–500 entries.');
    const entries=p.entries.map(validateEntry);
    if(new Set(entries.map(e=>e.id)).size!==entries.length)throw Error('Duplicate entry IDs.');
    return {app:APP,version:1,id:p.id,entries};
  }
  function validateReceipt(x) {
    if(!x||!UUID.test(x.id)||x.path!=='inbox/'+x.id+'.json'||!SHA.test(x.sha)||!Number.isFinite(x.acceptedAt))throw Error('Invalid delivery receipt.');
    return {id:x.id,path:x.path,sha:x.sha,acceptedAt:x.acceptedAt};
  }
  function readCollection(storage) {
    const raw=storage.getItem(COLLECTION_KEY);
    const value=raw===null?structuredClone(SETTINGS[APP].empty):JSON.parse(raw);
    const wrapped=value?.format==='assistant-local-collection';
    if(wrapped&&(value.version!==1||!Array.isArray(value.receipts)))throw Error('Local delivery receipts are unreadable. Restore a backup.');
    const data=wrapped?value.data:value,receipts=wrapped?value.receipts.map(validateReceipt):[];
    if(APP==='coffee'?!data||typeof data!=='object'||Array.isArray(data)||METHODS.some(m=>data[m]!==undefined&&!Array.isArray(data[m]))||data.beans!==undefined&&!Array.isArray(data.beans):!Array.isArray(data))throw Error('Local journal is unreadable. Restore a backup before saving.');
    return {format:'assistant-local-collection',version:1,data,receipts};
  }
  function writeCollection(storage,c) {
    const text=JSON.stringify(c.receipts.length?c:c.data);
    storage.setItem(COLLECTION_KEY,text);
    if(storage.getItem(COLLECTION_KEY)!==text)throw Error('Could not verify local save. Delivery was kept.');
  }
  function saveData(storage,data,restored=[]) {
    const current=readCollection(storage),receipts=new Map(current.receipts.map(r=>[r.id,r]));
    restored.map(validateReceipt).forEach(r=>{if(!receipts.has(r.id))receipts.set(r.id,r);});
    writeCollection(storage,{...current,data,receipts:[...receipts.values()]});
  }
  const norm=x=>String(x||'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
  function fingerprint(e,method) {
    const fields=APP==='matcha'?[e.name,e.company]:APP==='hotel'?[e.name,e.city,e.country]:[e.name,e.roaster,method||e.method];
    return JSON.stringify(fields.map(norm));
  }
  function mergeData(data,entries) {
    const next=structuredClone(data),existing=APP==='coffee'?METHODS.flatMap(m=>(next[m]||[]).map(e=>({...e,...(next.beans||[]).find(b=>b.id===e.beanId),id:e.id,method:m}))):next;
    const ids=new Set(existing.map(e=>e.id)),names=new Set(existing.map(e=>fingerprint(e)));
    let count=0;
    for(const e of entries) {
      if(ids.has(e.id)||names.has(fingerprint(e)))continue;
      ids.add(e.id);names.add(fingerprint(e));count++;
      if(APP==='coffee') {
        const bean=(next.beans||[]).find(b=>norm(b.name)===norm(e.name)&&norm(b.roaster)===norm(e.roaster));
        if(!next.beans)next.beans=[];
        if(!bean)next.beans.push({id:e.beanId,name:e.name,roaster:e.roaster,countries:e.countries,altitude:e.altitude});
        const {method,...entry}=e;
        (next[method]??=[]).push({...entry,beanId:bean?.id||e.beanId});
      } else next.push(e);
    }
    return {data:next,count};
  }
  function accepted(storage,p) {return readCollection(storage).receipts.some(r=>r.id===p.id&&r.path===p.path&&r.sha===p.sha);}
  function accept(storage,packet,payload) {
    const p=validatePayload(payload);
    if(p.id!==packet.id)throw Error('Delivery ID mismatch.');
    const receipt=validateReceipt({...packet,acceptedAt:Date.now()}),current=readCollection(storage);
    const prior=current.receipts.find(r=>r.id===packet.id);
    if(prior) {
      if(prior.sha!==packet.sha||prior.path!==packet.path)throw Error('Delivery ID was already used. Ask for a new batch.');
      return {data:current.data,count:0};
    }
    const result=mergeData(current.data,p.entries);
    writeCollection(storage,{...current,data:result.data,receipts:current.receipts.concat(receipt)});
    return result;
  }
  const b64 = bytes => {let s='';for (const b of new Uint8Array(bytes)) s+=String.fromCharCode(b);return btoa(s);};
  const un64 = s => {if(typeof s!=='string')throw Error('Invalid encrypted data.');return Uint8Array.from(atob(s),c=>c.charCodeAt(0));};
  const encode = x => new TextEncoder().encode(x);
  const decode = x => new TextDecoder().decode(x);
  async function keyId(publicKey) {
    const hash = await crypto.subtle.digest('SHA-256',encode(publicKey.n+':'+publicKey.e));
    return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  function aad(envelope) {return encode([APP+'-assistant-delivery',1,envelope.id,envelope.keyId].join(':'));}
  async function encryptDelivery(keyFile, input) {
    if (keyFile?.version!==1 || keyFile.type!==APP+'-assistant-public-key' || keyFile.publicKey?.d || keyFile.keyId!==await keyId(keyFile.publicKey)) throw Error('Use this app’s public delivery key.');
    const payload = validatePayload(input);
    const publicKey = await crypto.subtle.importKey('jwk',keyFile.publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    const aes = await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const envelope = {type:APP+'-assistant-delivery',version:1,id:payload.id,keyId:keyFile.keyId};
    envelope.key = b64(await crypto.subtle.encrypt({name:'RSA-OAEP'},publicKey,await crypto.subtle.exportKey('raw',aes)));
    envelope.iv = b64(iv);
    envelope.data = b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(envelope)},aes,encode(JSON.stringify(payload))));
    if (JSON.stringify(envelope).length > 900000) throw Error('Batch is too large. Split it into smaller batches.');
    return envelope;
  }
  async function decryptDelivery(envelope, identity) {
    if (envelope?.type!==APP+'-assistant-delivery' || envelope.version!==1 || !UUID.test(envelope.id)) throw Error('Unsupported delivery.');
    if (envelope.keyId!==identity.keyId) throw Error('Batch belongs to a different device. Ask for it to be resent after connecting this device.');
    const iv=un64(envelope.iv);
    if (iv.length!==12 || typeof envelope.data!=='string' || envelope.data.length>900000) throw Error('Invalid encrypted delivery size.');
    let payload;
    try {
      const raw = await crypto.subtle.decrypt({name:'RSA-OAEP'},identity.privateKey,un64(envelope.key));
      const aes = await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
      payload = JSON.parse(decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(envelope)},aes,un64(envelope.data))));
    } catch {throw Error('Batch could not be decrypted. It was not saved or deleted.');}
    if (payload.id!==envelope.id) throw Error('Delivery ID mismatch.');
    return validatePayload(payload);
  }
  function client({storage,fetch:fetcher,identity}) {
    function config() {const c=JSON.parse(storage.getItem(CONFIG_KEY)||'null');return c?.token ? c : null;}
    function disconnect() {storage.removeItem(CONFIG_KEY);}
    async function request(path,options={},token=config()?.token) {
      if (!token) throw Error('Connect this device to GitHub first.');
      const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
      try {
        const response=await fetcher('https://api.github.com/repos/'+REPO+'/contents/'+path,{...options,cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{})}});
        if (!response.ok) {const e=Error('GitHub '+response.status+'. Check the connection and Contents read/write permission.');e.status=response.status;throw e;}
        return response.status===204 ? null : response.json();
      } finally {clearTimeout(timer);}
    }
    async function pair(token,replace=false) {
      token=token.trim()||config()?.token;
      if (!token) throw Error('Enter a fine-grained token for '+REPO+'.');
      const local=await identity();let sha;
      try {
        const existing=await request('delivery-key.json?ref='+BRANCH,{},token);sha=existing.sha;
        const other=JSON.parse(decode(un64(existing.content.replace(/\s/g,''))));
        if (other.type!==APP+'-assistant-public-key' || other.keyId!==local.keyId) {
          if (!replace) {const e=Error('Another device is connected.');e.code='OTHER_DEVICE';throw e;}
        }
      } catch(e) {if(e.status!==404)throw e;}
      const content=b64(encode(JSON.stringify({type:APP+'-assistant-public-key',version:1,keyId:local.keyId,publicKey:local.publicKey},null,2)+'\n'));
      await request('delivery-key.json',{method:'PUT',body:JSON.stringify({message:'Connect '+APP+' delivery public key',branch:BRANCH,content,...(sha?{sha}:{})})},token);
      storage.setItem(CONFIG_KEY,JSON.stringify({token}));
    }
    async function list() {
      let files;
      try {files=await request('inbox?ref='+BRANCH);}catch(e){if(e.status===404)return [];throw e;}
      if(!Array.isArray(files)) throw Error('GitHub inbox is not a folder.');
      return files.filter(f=>f.type==='file' && UUID.test(f.name.replace(/\.json$/,'')) && f.name.endsWith('.json')).map(f=>{
        if (f.path!=='inbox/'+f.name || !SHA.test(f.sha)) throw Error('Invalid inbox file.');
        return {id:f.name.slice(0,-5),path:f.path,sha:f.sha,size:f.size};
      });
    }
    async function read(packet) {
      if(packet.size>900000)throw Error('Batch is too large. Ask for smaller batches.');
      const file=await request(packet.path+'?ref='+BRANCH);
      if(file.sha!==packet.sha)throw Error('Batch changed. Check deliveries again.');
      if(file.encoding!=='base64'||file.size>900000)throw Error('Unsupported batch size or encoding.');
      const envelope=JSON.parse(decode(un64(file.content.replace(/\s/g,''))));
      if(envelope.id!==packet.id)throw Error('Batch filename does not match its delivery ID.');
      return decryptDelivery(envelope,await identity());
    }
    async function cleanup(packet) {
      if(!accepted(storage,packet))throw Error('Save and accept this exact batch locally before deleting it.');
      try {await request(packet.path,{method:'DELETE',body:JSON.stringify({message:'Remove accepted encrypted '+APP+' batch',sha:packet.sha,branch:BRANCH})});}
      catch(e) {
        if(e.status!==404)throw e;
        // A 404 may also mean a revoked token. Confirm repo access before treating it as gone.
        await request('delivery-key.json?ref='+BRANCH);
      }
    }
    return {config,disconnect,pair,list,read,cleanup};
  }
  return {APP,REPO,BRANCH,COLLECTION_KEY,CONFIG_KEY,validateEntry,validatePayload,validateReceipt,readCollection,saveData,mergeData,accepted,accept,b64,un64,keyId,encryptDelivery,decryptDelivery,client};
}
root.AssistantInboxCore=createCore;
if(typeof module!=='undefined'&&module.exports)module.exports=createCore;
})(globalThis);
