import 'fake-indexeddb/auto';
import { createDocument, createController, serializeDocument } from '/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io/src/domain/index.ts';
import { createCrdtController } from '/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io/src/crdt/controller.ts';
import { attachIndexedDbPersistence } from '/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io/src/crdt/persistence.ts';
import { createDocumentAuthority } from '/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io/src/session/authority.ts';
import { createWhiteboardStore } from '/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io/src/renderer/state/whiteboard.ts';
import { CloseHandshakeCoordinator } from '/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io/electron/close-handshake.ts';
import { writeFile } from 'node:fs/promises';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const caught=(fn:()=>unknown)=>{try{return {ok:true,value:fn()};}catch(e:any){return {ok:false,code:e.code,message:e.message};}};
async function seeded(label:string){
 const seed=createCrdtController(createDocument(label));
 // Synthetic deterministic Yjs conflict ordering, never a user cache. The changed title entry wins a later fresh bootstrap.
 seed.ydoc.clientID=0xfffffffe;
 seed.dispatch({type:'rename',title:label+' cached'},{actorId:'human:seed',expectedRevision:0,source:'human'});
 const doc=seed.getSnapshot().document;
 const persistence=attachIndexedDbPersistence(seed,`document:${doc.id}`);await persistence.ready;await wait(30);await persistence.destroy();seed.destroy();return doc;
}
async function pure(){
 const cached=await seeded('Pure');const incoming={...cached,title:'Incoming Git document'};
 const controller=createCrdtController(incoming);const fatal:any[]=[];
 const persistence=attachIndexedDbPersistence(controller,`document:${incoming.id}`);
 const authority=createDocumentAuthority({controller,onFatal:(x:any)=>fatal.push(x)});
 const before=authority.source.getSnapshot();await persistence.ready;
 const after=caught(()=>authority.source.getSnapshot());
 const binding=caught(()=>authority.bindActor({actorId:'agent:probe',source:'agent',grantId:'grant:probe',grantGeneration:1,guard:()=>({allowed:true})}));
 const result={before:{title:before.document.title,revision:before.revision},controllerAfter:{title:controller.getSnapshot().document.title,revision:controller.getSnapshot().revision},authorityAfter:after,grantBindingAfter:binding,fatal};
 await persistence.destroy();controller.destroy();return result;
}
async function storeCase(){
 const cached=await seeded('Store');const incoming={...cached,title:'Authoritative Git state'};
 let pluginListener:any, closeListener:any, saveCalls=0, windowCloseCalls=0;const closeReplies:any[]=[];const authorities:any[]=[];const fatal:any[]=[];
 const file=(token:string)=>({handleId:'hdl_0123456789abcdef0123456789abcdef',name:'synthetic.sketchdraw.json',versionToken:`sha256:${token.repeat(64)}`});
 const settings={available:true,projectFolder:'/synthetic',profiles:[],activeProfileId:'default',git:{installed:true,enabled:false,autoCommit:false,autoPull:false,autoPush:false},atlassian:{installed:true,enabled:false}};
 const coordinator=new CloseHandshakeCoordinator({sendCloseRequested:(id)=>closeListener(id),closeWindow:()=>{windowCloseCalls++}});
 const bridge:any={platform:'electron',openDocument:async()=>({status:'opened',text:serializeDocument(cached),file:file('1')}),saveDocument:async()=>{saveCalls++;return {status:'cancelled'}},exportFile:async()=>({status:'cancelled'}),openExternal:async()=>{},onCloseRequested:(fn:any)=>{closeListener=fn;return ()=>{}},respondToClose:async(requestId:string,decision:string)=>{closeReplies.push({requestId,decision});coordinator.handleRendererResponse({requestId,decision});},onMenuCommand:()=>()=>{},plugins:{getSettings:async()=>settings,onEvent:(fn:any)=>{pluginListener=fn;return ()=>{}},watchDocument:async()=>({ok:true}),afterDocumentSaved:async()=>{}}};
 const store=createWhiteboardStore({bridge,controller:createController(cached),preferences:null,authorityFactory:(controller:any)=>{const a=createDocumentAuthority({controller,onFatal:(x:any)=>fatal.push(x)});authorities.push({a,controller});return a;}});
 store.setViewportSize(1000,700);await store.openDocument();await wait(80);
 const before=caught(()=>store.getAuthority()!.source.getSnapshot());
 pluginListener({type:'document-changed',text:serializeDocument(incoming),file:file('2')});await wait(100);
 const current=authorities.at(-1);const after=caught(()=>store.getAuthority()!.source.getSnapshot());
 let closePrevented=false;const closeEvent=coordinator.onWindowCloseEvent({preventDefault:()=>{closePrevented=true;}});await wait(25);
 let saveResult:any;try{await store.save();saveResult={ok:true};}catch(e:any){saveResult={ok:false,code:e.code,message:e.message};}
 const result={before:before.ok?{ok:true,title:(before.value as any).document.title,revision:(before.value as any).revision}:before,storeTitle:store.state.document.title,storeRevision:store.state.revision,storeSaveStatus:store.state.saveStatus,controllerAfter:{title:current.controller.getSnapshot().document.title,revision:current.controller.getSnapshot().revision},authorityAfter:after,fatal,closePrevented,closeEvent,closeReplies,windowCloseCalls,closeConfirmed:coordinator.isCloseConfirmed(),saveResult,saveBridgeCalls:saveCalls,notices:store.state.notices.map(x=>x.text)};
 const disposed=caught(()=>store.dispose());(result as any).disposeResult=disposed.ok?{ok:true}:disposed;return result;
}
(async()=>{const result={checkedAt:new Date().toISOString(),scope:'isolated in-memory fake-indexeddb; real product functions bundled into /tmp; no UI, real runtime, filesystem cache or Tenant',determinism:'Synthetic cached title mutation uses Y.Doc clientID 0xfffffffe so cache-vs-fresh-bootstrap winner ordering is stable. No production source modified.',pure:await pure(),store:await storeCase()};await writeFile('/tmp/sketchdraw-217-authority-probe/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exit(result.pure.authorityAfter.code==='AUTHORITY_DIVERGED'&&result.store.authorityAfter.code==='AUTHORITY_DIVERGED'&&result.store.closeReplies.some((r:any)=>r.decision==='cancel')?0:2);})().catch(e=>{console.error(e);process.exit(1)});
