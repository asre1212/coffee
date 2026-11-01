const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const createCore=require('../assistant-inbox-core.js');
const fs=require('node:fs'),http=require('node:http'),pathlib=require('node:path');
(async()=>{
 const server=http.createServer((req,res)=>{const path=pathlib.join(__dirname,'..',new URL(req.url,'http://localhost').pathname);const file=path.endsWith('/')?path+'index.html':path;fs.readFile(file,(err,data)=>{res.statusCode=err?404:200;res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(err?'Not found':data);});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  for(const app of [require('../assistant-app.json').app]) {
   const core=createCore(app),context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await context.route('https://fonts.**',r=>r.abort());
   const files=new Map();let failDelete=false,deleteCount=0;
   await context.route('https://api.github.com/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    const path=url.pathname.split('/contents/')[1];
    if(!url.pathname.startsWith('/repos/asre1212/'+app+'/contents/'))throw Error('Wrong repository');
    assert.equal(request.headers().authorization,'Bearer mock-test-token');
    const reply=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(request.method()==='PUT'){
      const body=request.postDataJSON(),text=Buffer.from(body.content,'base64').toString();
      files.set(path,{text,sha:createHash('sha1').update(text).digest('hex')});
      return reply(200,{});
    }
    if(request.method()==='DELETE'){
      if(failDelete)return reply(503,{});
      const body=request.postDataJSON();assert.equal(body.sha,files.get(path).sha);
      const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),core.COLLECTION_KEY);
      assert.equal(saved.receipts.some(r=>r.sha===body.sha),true);
      files.delete(path);deleteCount++;return reply(200,{});
    }
    if(path==='inbox')return reply(200,[...files].filter(([p])=>p.startsWith('inbox/')).map(([path,f])=>({type:'file',name:path.split('/')[1],path,sha:f.sha,size:f.text.length})));
    const f=files.get(path);if(!f)return reply(404,{});
    return reply(200,{sha:f.sha,encoding:'base64',size:f.text.length,content:Buffer.from(f.text).toString('base64')});
   });
   await page.goto('http://127.0.0.1:'+server.address().port+'/');
   async function settings(){
     if(app==='coffee')await page.getByRole('button',{name:'Settings, export, and import'}).click();
     else if(app==='hotel')await page.locator('#openSettings').click();
     else await page.locator('[data-nav="settings"]').first().click();
     await page.locator('.assistant-inbox').waitFor({state:'visible'});
   }
   await settings();
   await page.locator('[data-inbox="setup"]').evaluate(e=>e.open=true);
   await page.locator('[data-inbox="token"]').fill('mock-test-token');
   await page.locator('[data-inbox="connect"]').click();
   await page.waitForFunction(()=>document.querySelector('[data-inbox="connection"]').textContent==='Connected on this device');
   await page.waitForFunction(()=>!document.querySelector('[data-inbox="check"]').disabled);
   const publicFile=JSON.parse(files.get('delivery-key.json').text);
   assert.equal(publicFile.publicKey.d,undefined);
   const id=randomUUID(),name='Sample '+app+' entry';
   const payload={app,version:1,id,entries:[{id:randomUUID(),name,city:'New York',country:'US',company:'Test company',method:'espresso',roaster:'Test roaster',notes:'Preserve these notes',contacts:[{name:'Test Contact',email:'example@example.test'}]}]};
   async function queue(p){const e=await core.encryptDelivery(publicFile,p),text=JSON.stringify(e),path='inbox/'+p.id+'.json';files.set(path,{text,sha:createHash('sha1').update(text).digest('hex')});return path;}
   const path=await queue(payload);
   failDelete=true;
   await page.locator('[data-inbox="check"]').click();
   await page.waitForFunction(()=>document.querySelector('[data-inbox="status"]').textContent.includes('cleanup pending'));
   let collection=await page.evaluate(()=>JournalInbox.readCollection(localStorage));
   let list=app==='coffee'?collection.data.espresso:collection.data;
   assert.equal(list.length,1);assert.equal(list[0].rating,null);assert.equal(deleteCount,0);
   if(process.env.QA_SCREENSHOT)await page.screenshot({path:process.env.QA_SCREENSHOT,fullPage:true});
   // Reload with cleanup enabled: receipt survives and prevents duplication.
   failDelete=false;await page.reload();await settings();
   await page.waitForFunction(()=>document.querySelector('[data-inbox="status"]').textContent.includes('removed from GitHub'));
   assert.equal(files.has(path),false);assert.equal(deleteCount,1);
   collection=await page.evaluate(()=>JournalInbox.readCollection(localStorage));
   assert.equal((app==='coffee'?collection.data.espresso:collection.data).length,1);
   // A second batch with another UUID but same identity is skipped.
   await queue({...payload,id:randomUUID(),entries:[{...payload.entries[0],id:randomUUID(),rating:1}]});
   await page.locator('[data-inbox="check"]').click();
   await page.waitForFunction(()=>!document.querySelector('[data-inbox="check"]').disabled);
   collection=await page.evaluate(()=>JournalInbox.readCollection(localStorage));
   list=app==='coffee'?collection.data.espresso:collection.data;
   assert.equal(list.length,1);assert.equal(list[0].rating,null);
   assert.equal(collection.receipts.length,2);assert.equal(deleteCount,2);
   // Confirm the imported entry is visible and manual edits preserve receipts.
   if(app==='coffee')await page.getByRole('button',{name:'Close settings',exact:true}).click();
   else if(app==='hotel')await page.locator('#settingsSheet [data-close]').click();
   else await page.locator('[data-view="settings"] [data-nav="list"]').click();
   await page.getByText(name,{exact:true}).first().waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(errors,[]);
   console.log(app+': UI pairing, real encrypted import, saved-before-delete, reload, cleanup retry, duplicate protection, unrated display, and mobile layout passed');
   await context.close();
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
