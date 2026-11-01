const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,webcrypto}=require('node:crypto');
globalThis.crypto ||= webcrypto;
const createCore=require('../assistant-inbox-core.js');
const APP=process.env.INBOX_APP || require('../assistant-app.json').app;
const core=createCore(APP);
function storage(){const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
function entry(name='Test entry'){return {id:randomUUID(),name,company:'Producer',city:'Test city',country:'US',method:'espresso',roaster:'Producer',rating:4.2};}
function batch(entries=[entry()]){return {version:1,app:APP,id:randomUUID(),entries};}
function packet(p){return {id:p.id,path:'inbox/'+p.id+'.json',sha:'a'.repeat(40)};}
let keys;
async function identity(){
  if(keys)return keys;
  const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
  const publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey);
  keys={type:APP+'-assistant-public-key',version:1,publicKey,privateKey:pair.privateKey,keyId:await core.keyId(publicKey)};
  return keys;
}
function entries(data){return APP==='coffee'?['espresso','pourover','frenchpress'].flatMap(m=>data[m]||[]):data;}
test('real encryption round trip, tampering and wrong recipient',async()=>{
  const id=await identity(),p=batch(),encrypted=await core.encryptDelivery(id,p);
  assert.equal(JSON.stringify(encrypted).includes('Test entry'),false);
  const clear=await core.decryptDelivery(encrypted,id);
  assert.equal(clear.entries[0].rating,4.2);
  assert.equal(clear.entries[0].name,p.entries[0].name);
  await assert.rejects(core.decryptDelivery({...encrypted,keyId:'different'},id),/different device/);
  const data=core.un64(encrypted.data);data[0]^=1;
  await assert.rejects(core.decryptDelivery({...encrypted,data:core.b64(data)},id),/could not be decrypted/);
});
test('append preserves legacy data, suppresses duplicates and retains receipts through edits',()=>{
  const s=storage(),existing=entry('Existing');
  const original=APP==='coffee'?{beans:[{id:'bean1',name:'Existing',roaster:'Producer'}],espresso:[{...existing,beanId:'bean1'}],pourover:[],frenchpress:[],notes:'Keep notebook'}:[existing];
  s.setItem(core.COLLECTION_KEY,JSON.stringify(original));
  const duplicate={...existing,id:randomUUID()};
  const p=batch([entry('New'),duplicate]),f=packet(p);
  assert.equal(core.accept(s,f,p).count,1);
  assert.equal(entries(core.readCollection(s).data).length,2);
  assert.equal(core.accept(s,f,p).count,0);
  core.saveData(s,original);
  assert.equal(core.accept(s,f,p).count,0);
  assert.equal(entries(core.readCollection(s).data).length,1);
  assert.throws(()=>core.accept(s,{...f,sha:'b'.repeat(40)},p),/already used/);
  assert.deepEqual(core.readCollection(s).data,original);
});
test('failed atomic save creates no receipt and cannot trigger deletion',async()=>{
  const s=storage(),p=batch(),f=packet(p);let calls=0;
  const fail={...s,setItem:()=>{throw Error('QuotaExceeded');}};
  assert.throws(()=>core.accept(fail,f,p),/Quota/);
  assert.equal(core.accepted(s,f),false);
  const c=core.client({storage:s,fetch:()=>{calls++;},identity});
  await assert.rejects(c.cleanup(f),/Save and accept/);
  assert.equal(calls,0);
});
test('cleanup retry uses only the exact accepted SHA and never adds again',async()=>{
  const s=storage(),p=batch(),f=packet(p);core.accept(s,f,p);
  s.setItem(core.CONFIG_KEY,JSON.stringify({token:'test-token'}));
  const calls=[];let fail=true;
  const c=core.client({storage:s,identity,fetch:async(url,opts)=>{
    calls.push({url,opts});return {ok:!fail,status:fail?503:200,json:async()=>({})};
  }});
  await assert.rejects(c.cleanup(f),/503/);fail=false;
  assert.equal(core.accept(s,f,p).count,0);
  await c.cleanup(f);
  assert.equal(calls.length,2);
  assert.equal(JSON.parse(calls[1].opts.body).sha,f.sha);
  assert.equal(calls[1].opts.headers.Authorization,'Bearer test-token');
  assert.equal(calls[1].opts.redirect,'error');
  await assert.rejects(c.cleanup({...f,sha:'b'.repeat(40)}),/exact batch/);
});
test('invalid entire batch is rejected without saving; blank ratings stay null',()=>{
  const s=storage(),p=batch();p.entries.push({...entry(),rating:6});
  assert.throws(()=>core.accept(s,packet(p),p),/rating/);
  assert.equal(s.getItem(core.COLLECTION_KEY),null);
  const unknown=entry();delete unknown.rating;
  assert.equal(core.validateEntry(unknown).rating,null);
  assert.throws(()=>core.validatePayload({...batch(),app:'another'}),/batch/);
  assert.throws(()=>core.validatePayload(batch([{...entry(),name:' '} ])),/name/);
  if(APP==='coffee')assert.throws(()=>core.validateEntry({...entry(),method:'unknown'}),/method/);
});
test('backup round trip includes receipts, not connection credentials',()=>{
  const s=storage(),p=batch(),f=packet(p);core.accept(s,f,p);
  s.setItem(core.CONFIG_KEY,JSON.stringify({token:'private-token'}));
  const exported=core.readCollection(s),other=storage();
  core.saveData(other,exported.data,exported.receipts);
  assert.equal(core.accepted(other,f),true);
  assert.equal(JSON.stringify(exported).includes('private-token'),false);
});
test('unreadable legacy storage is not replaced',()=>{
  const s=storage();s.setItem(core.COLLECTION_KEY,'broken');
  const p=batch();assert.throws(()=>core.accept(s,packet(p),p));
  assert.equal(s.getItem(core.COLLECTION_KEY),'broken');
});
test('new key pairing requires confirmation before replacing another device',async()=>{
  const s=storage();let writes=0;
  const c=core.client({storage:s,identity,fetch:async(url,opts)=>{
    if(opts.method==='PUT'){writes++;return {ok:true,status:200,json:async()=>({})};}
    return {ok:true,status:200,json:async()=>({sha:'a'.repeat(40),content:core.b64(new TextEncoder().encode(JSON.stringify({type:APP+'-assistant-public-key',keyId:'other'})))})};
  }});
  await assert.rejects(c.pair('test-token'),e=>e.code==='OTHER_DEVICE');
  assert.equal(writes,0);
  await c.pair('test-token',true);assert.equal(writes,1);
});
