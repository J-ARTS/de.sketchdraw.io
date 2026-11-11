// Optional reference validation. No Mermaid runtime is added to the product.
// npm install --prefix /tmp/sketchdraw-mermaid-reference --ignore-scripts --no-save mermaid@12.3.0 jsdom@31.0.0
// node docs/reviews/153-mermaid-reference-check.mjs /tmp/sketchdraw-mermaid-reference
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const referenceDir = path.resolve(process.argv[2] || '/tmp/sketchdraw-153-mermaid-check');
const requireReference = createRequire(path.join(referenceDir, 'package.json'));
const { JSDOM } = requireReference('jsdom');
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../', import.meta.url));
const output=path.join(root,'docs/reviews/fixtures/153-mermaid');
await mkdir(output,{recursive:true});
const referenceModule=path.dirname(requireReference.resolve('mermaid/package.json'));
assert.equal(requireReference('mermaid/package.json').version,'12.3.0');
const built=await build({stdin:{contents:"export { createDocument, createElement } from './src/domain'; export { prepareMermaidExport, importMermaid } from './src/interop';",resolveDir:root,loader:'ts'},bundle:true,alias:{'@':root+'/src'},platform:'browser',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const dom=new JSDOM('');globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.DOMParser=dom.window.DOMParser;
const {decodeEntities}=await import(pathToFileURL(path.join(referenceModule,'dist/chunks/mermaid.core/chunk-6MUBBAK2.mjs')));
const decoded=(text)=>{const el=dom.window.document.createElement('textarea');el.innerHTML=decodeEntities(text);return el.value;};
const {default:mermaid}=await import(pathToFileURL(path.join(referenceModule,'dist/mermaid.esm.mjs')));
mermaid.initialize({startOnLoad:false,securityLevel:'strict'});
const doc=api.createDocument('Reference interoperability');doc.id='reference:153';
const labels=['Start', 'Entscheidung & "Quote"', 'Store [x]; (yes)', '<img onerror=bad> & #35; + `code`', 'Unicode: Größe 日本語'];
const kinds=['rectangle','diamond','ellipse','sticky-note','text'];
doc.elements=labels.map((text,i)=>api.createElement(kinds[i],{id:`node:${i}`,text:i===0?'':text,label:i===0?text:undefined,x:i*220,y:80,width:180,height:100}));
for(let i=1;i<labels.length;i++)doc.elements.push(api.createElement('connector',{id:`edge:${i}`,label:i===1?'Ja | nein; "x"':'Weiter',x:180+(i-1)*220,y:130,width:40,height:0,points:[{x:0,y:0},{x:40,y:0}],from:{elementId:`node:${i-1}`,anchor:{x:1,y:.5}},to:{elementId:`node:${i}`,anchor:{x:0,y:.5}}}));
const evidence=[];
for(const embedDocument of [false,true]){
 const result=api.prepareMermaidExport(doc,{embedDocument});
 const parsed=await mermaid.parse(result.contents);
 assert.equal(parsed.diagramType,'flowchart-v2');
 const diagram=await mermaid.mermaidAPI.getDiagramFromText(result.contents);
 assert.equal(diagram.db.getVertices().size,labels.length);
 assert.equal(diagram.db.getEdges().length,labels.length-1);
 assert.equal(diagram.db.getVertices().get('n0').text,'Start');
 assert.equal(decoded(diagram.db.getEdges()[0].text),'Ja | nein; \"x\"');
 for(let i=0;i<labels.length;i++) assert.equal(decoded(diagram.db.getVertices().get('n'+i).text),labels[i]);
 const restored=api.importMermaid(result.contents);
 assert.equal(restored.document.elements.length,doc.elements.length);
 const name=path.join(output,`${embedDocument?'embedded':'portable'}.mmd`);
 await writeFile(name,result.contents);
 evidence.push({embedDocument,sha256:createHash('sha256').update(result.contents).digest('hex'),bytes:Buffer.byteLength(result.contents),diagramType:parsed.diagramType,nodes:diagram.db.getVertices().size,edges:diagram.db.getEdges().length,ownFidelity:restored.fidelity,fixture:path.relative(root,name),literalNodeAndEdgeLabels:true});
}
for(const direction of ['LR','RL','TB','TD','BT']) {
 const source=`flowchart ${direction}\nsubgraph group["Outer"]\nA[Start] -->|"Go ❤"| B(Rounded) --> C((Circle))\nC -- back --> A\nD{Decision} -.-> E[(Database)]\nF[[Process]] ==> G{{Hexagon}}\nA --- D\nend`;
 const native = await mermaid.mermaidAPI.getDiagramFromText(source);
 assert.equal(native.db.getVertices().size,7); assert.equal(native.db.getEdges().length,6);
 const imported=api.importMermaid(source);
 assert.equal(imported.document.elements.length,14);
 const exported=api.prepareMermaidExport(imported.document,{embedDocument:false});
 const actual=await mermaid.mermaidAPI.getDiagramFromText(exported.contents);
 assert.equal(actual.db.getVertices().size,7); assert.equal(actual.db.getEdges().length,6);
 assert.equal(actual.db.getSubGraphs().length,1);
 const name=path.join(output,`foreign-${direction}.mmd`);
 await writeFile(name,source);
 evidence.push({direction,nodes:7,edges:6,groups:1,importAndExportParsed:true,fixture:path.relative(root,name),sha256:createHash('sha256').update(source).digest('hex')});
}
{
 const source='flowchart LR\nA --> B\nsubgraph inner[Inner]\nA\nB\nend';
 const actual=await mermaid.mermaidAPI.getDiagramFromText(source);
 assert.deepEqual([...actual.db.getSubGraphs()[0].nodes].sort(),['A','B']);
 const imported=api.importMermaid(source);
 assert.equal(imported.document.elements.find(el=>el.id==='A').parentId,'inner');
 assert.equal(imported.document.elements.find(el=>el.id==='B').parentId,'inner');
 const name=path.join(output,'foreign-forward-membership.mmd');
 await writeFile(name,source);
 evidence.push({case:'forward-membership',nodes:2,edges:1,groups:1,membershipMatchesOfficial:true,fixture:path.relative(root,name),sha256:createHash('sha256').update(source).digest('hex')});
}
const cases = [
 ['empty-document',[]],['empty-node',[api.createElement('rectangle',{id:'a'})]],
 ['empty-group',[api.createElement('container',{id:'a'})]],
 ...['fa:fa-home','stylesheet https://a.b/c?x=1','style:x(y)','First\nSecond','Unicode 日本語'].map(text=>[text,[api.createElement('rectangle',{id:'a',text})]]),
 ['self-link',[api.createElement('rectangle',{id:'a',text:'A'}),api.createElement('connector',{id:'e',from:{elementId:'a',anchor:{x:1,y:.5}},to:{elementId:'a',anchor:{x:0,y:.5}}})]],
 ['free-endpoint',[api.createElement('connector',{id:'e'})]],
 ['container-child',[api.createElement('container',{id:'a',text:'Group'}),api.createElement('rectangle',{id:'b',text:'Child',parentId:'a'}),api.createElement('connector',{id:'e',from:{elementId:'a',anchor:{x:1,y:.5}},to:{elementId:'b',anchor:{x:0,y:.5}}})]]
];
for(const [name,elements] of cases){
 const doc=api.createDocument();doc.elements=elements;
 const out=api.prepareMermaidExport(doc,{embedDocument:false});
 const native=await mermaid.mermaidAPI.getDiagramFromText(out.contents);
 if(elements.length===1 && elements[0].kind==='rectangle'){
  const text=decoded(native.db.getVertices().get('n0').text);
  assert.equal(text.trim()?text:'',elements[0].text ?? '');
  if(name==='fa:fa-home') assert.ok(!/(fa[bklrs]?):fa-([\w-]+)/.test(decodeEntities(native.db.getVertices().get('n0').text)),'No icon trigger before HTML entity decoding');
 }
 if(name==='empty-group')assert.equal(native.db.getSubGraphs().length,1);
 const own=api.importMermaid(out.contents);
 if(name==='empty-node'||name==='empty-group')assert.equal(own.document.elements[0].text,'');
 const filename='edge-case-'+cases.indexOf(cases.find(c=>c[0]===name))+'.mmd';
 const file=path.join(output,filename);await writeFile(file,out.contents);
 evidence.push({case:name,officialParserPassed:true,ownImporterPassed:true,fixture:path.relative(root,file),sha256:createHash('sha256').update(out.contents).digest('hex')});
}
await writeFile(path.join(root,'docs/reviews/153-mermaid-reference.json'),JSON.stringify({runtime:'mermaid@12.3.0',dom:'jsdom@31.0.0',scope:'Official parser and flowchart DB, no external service and no pixel rendering claim',cases:evidence},null,2));
console.log(JSON.stringify(evidence));
