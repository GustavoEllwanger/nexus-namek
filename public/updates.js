// Each tab can finish its own fight even if another tab activates the update first.
export async function watchUpdates(canReload,settled){
  if(location.protocol==='file:'||!('serviceWorker' in navigator))return;
  const sw=navigator.serviceWorker;
  const build=document.querySelector('meta[name="nexus-build"]').content;
  const status=document.getElementById('update-status');
  let target=null;
  let pending=false,reloading=false,checking=false,lastCheck=0;
  function readVersion(){
    const controller=sw.controller;
    if(!controller)return;
    const channel=new MessageChannel();
    const timer=setTimeout(()=>channel.port1.close(),5000);
    channel.port1.onmessage=({data})=>{
      clearTimeout(timer);channel.port1.close();
      if(controller!==sw.controller||typeof data!=='string')return;
      target=data;
      const version=value=>/^nexus-namek-(\d+)$/.exec(value)?.[1];
      pending=Number(version(data))>Number(version(build));
      try{if(sessionStorage.getItem('nexus.update.attempt')===build+'>'+data)pending=false;}catch{pending=false;}
      status.hidden=!pending;
      if(pending)void apply();
    };
    controller.postMessage({type:'NEXUS_VERSION'},[channel.port2]);
  }
  async function apply(){
    if(!pending||reloading||document.hidden||!navigator.onLine||!canReload())return;
    reloading=true;
    await settled();
    if(!pending||document.hidden||!navigator.onLine||!canReload()){reloading=false;return;}
    try{sessionStorage.setItem('nexus.update.attempt',build+'>'+target);}catch{reloading=false;return;}
    location.reload();
  }
  sw.addEventListener('controllerchange',readVersion);
  const reg=await sw.register('./sw.js',{updateViaCache:'none'});
  function activate(){reg.waiting?.postMessage({type:'NEXUS_ACTIVATE'});}
  function installing(){
    const worker=reg.installing;
    worker?.addEventListener('statechange',()=>{if(worker.state==='installed')activate();});
    activate();
  }
  reg.addEventListener('updatefound',installing);
  installing();readVersion();
  async function check(){
    if(document.hidden||!navigator.onLine)return;
    readVersion();
    if(checking||Date.now()-lastCheck<15000)return;
    checking=true;lastCheck=Date.now();
    try{await reg.update();activate();}catch{/* Keep the installed release available offline. */}
    finally{checking=false;}
  }
  setInterval(check,60000);
  setInterval(apply,750);
  document.addEventListener('visibilitychange',check);
  window.addEventListener('online',check);
  window.addEventListener('pageshow',check);
  void check();
}
