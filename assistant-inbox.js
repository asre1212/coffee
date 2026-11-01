/* Receiving device controller. Tokens and private keys never leave this origin except
   the token's Authorization header to the fixed GitHub API repository. */
(function(root){
  'use strict';
  function create({core,onSaved}) {
    let keyPromise,checking=false,connecting=false,host=null;
    let message='Connect this device once to receive entries from chat.';
    async function identity() {
      if(keyPromise)return keyPromise;
      keyPromise=(async()=>{
        if(!crypto.subtle)throw Error('Encrypted delivery needs HTTPS.');
        const db=await new Promise((resolve,reject)=>{
          const r=indexedDB.open(core.APP+'.assistant.keys.v1',1);
          r.onupgradeneeded=()=>r.result.createObjectStore('settings');
          r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
        });
        try {
          const existing=await new Promise((resolve,reject)=>{
            const r=db.transaction('settings').objectStore('settings').get('identity');
            r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
          });
          if(existing)return existing;
          const keys=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
          const publicKey=await crypto.subtle.exportKey('jwk',keys.publicKey);
          const generated={privateKey:keys.privateKey,publicKey,keyId:await core.keyId(publicKey)};
          return await new Promise((resolve,reject)=>{
            const tx=db.transaction('settings','readwrite'),s=tx.objectStore('settings'),r=s.get('identity');let chosen;
            r.onsuccess=()=>{chosen=r.result||generated;if(!r.result)s.put(chosen,'identity');};
            tx.oncomplete=()=>resolve(chosen);tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};
          });
        } finally {db.close();}
      })().catch(e=>{keyPromise=null;throw e;});
      return keyPromise;
    }
    const client=core.client({storage:localStorage,fetch:(...args)=>fetch(...args),identity});
    const $=name=>host?.querySelector('[data-inbox="'+name+'"]');
    function status(text){message=text;render();}
    function render(){
      if(!host)return;
      const connected=!!client.config();
      $('status').textContent=message;
      $('connection').textContent=connected?'Connected on this device':'Not connected on this device';
      $('check').disabled=!connected||checking||connecting;
      $('connect').disabled=checking||connecting;
      $('disconnect').hidden=!connected;
      $('disconnect').disabled=checking||connecting;
      $('token').placeholder=connected?'Leave blank to keep saved token':'GitHub fine-grained token';
    }
    async function check(){
      if(checking||connecting||!client.config())return;
      checking=true;status('Checking for entries…');
      let added=0,removed=0;const errors=[];
      const work=async()=>{
        const files=await client.list();
        for(const packet of files.slice(0,100)) {
          try {
            if(!core.accepted(localStorage,packet)) {
              const payload=await client.read(packet);
              const result=core.accept(localStorage,packet,payload);
              // Save and receipt are one atomic write; update the app before cleanup.
              onSaved(result.data);added+=result.count;
            }
            try{await client.cleanup(packet);removed++;}
            catch(e){errors.push('Saved locally; cleanup pending. '+e.message);}
          }catch(e){errors.push('Delivery '+packet.id.slice(0,8)+': '+e.message);}
        }
        if(files.length>100)errors.push('More batches remain. Check entries again.');
      };
      try {
        if(navigator.locks)await navigator.locks.request(core.APP+'-assistant-inbox',work);else await work();
        status((added?added+' new '+(added===1?'entry':'entries')+' saved.':'No new entries.')+(removed?' '+removed+' saved '+(removed===1?'batch':'batches')+' removed from GitHub.':'')+(errors.length?' '+errors.join(' '):''));
      }catch(e){status(e.message);}finally{checking=false;render();}
    }
    function mount(element){
      host=element;
      host.innerHTML=`<section class="assistant-inbox" aria-label="Assistant entries">
        <h3>Assistant entries</h3>
        <p>Entries sent in chat are added to this device. Existing entries are kept; duplicates are skipped.</p>
        <p data-inbox="connection"></p>
        <div class="assistant-actions"><button type="button" data-inbox="check">Check entries</button><button type="button" data-inbox="disconnect" hidden>Disconnect</button></div>
        <p data-inbox="status" role="status" aria-live="polite"></p>
        <details data-inbox="setup"><summary>Connect this device</summary>
          <p>Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">fine-grained GitHub token</a> for <strong>${core.REPO}</strong> with <strong>Contents: Read and write</strong>. You can select matcha, coffee, and hotel in one token, then connect each app.</p>
          <label>GitHub token<input data-inbox="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
          <p>The token and receiving key stay on this device. GitHub receives a public key and encrypted batches. Connect from your installed app.</p>
          <button type="button" data-inbox="connect">Connect this device</button>
        </details>
      </section>`;
      $('check').onclick=check;
      $('disconnect').onclick=()=>{client.disconnect();$('token').value='';status('Disconnected. Saved entries and the receiving key are kept.');};
      $('connect').onclick=async()=>{
        if(checking||connecting)return;
        connecting=true;status('Connecting…');
        let connected=false;
        try {
          const token=$('token').value;
          try{await client.pair(token);}catch(e){
            if(e.code!=='OTHER_DEVICE')throw e;
            if(!confirm('Replace the other receiving device? Pending batches for that device will need to be resent. Its saved entries stay there.')){status('Connection unchanged.');return;}
            await client.pair(token,true);
          }
          $('token').value='';$('setup').open=false;connected=true;
          status('Connected. Ask in chat to send entries to this app.');
          navigator.storage?.persist?.().catch(()=>{});
        }catch(e){status(e.message);}finally{connecting=false;render();}
        if(connected)await check();
      };
      render();return ()=>{if(host===element)host=null;};
    }
    const visible=()=>{if(!document.hidden)check();};
    window.addEventListener('online',check);
    document.addEventListener('visibilitychange',visible);
    check();
    return {mount,check,destroy(){window.removeEventListener('online',check);document.removeEventListener('visibilitychange',visible);host=null;}};
  }
  root.AssistantInbox={create};
})(globalThis);
