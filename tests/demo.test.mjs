import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Engine} from '../lib/engine.mjs';
import {importDemo} from '../lib/demo.mjs';
import {run} from '../lib/media.mjs';
test('静音演示真实导入与修改回传，不伪造转写和样片审批',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'laodongcut-demo-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const video=path.join(dir,'demo.mp4');await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=black:s=360x640:r=30:d=1','-an','-c:v','libx264',video]);
 const engine=await new Engine(path.join(dir,'data')).init();const doc={mode:'silent-visual-demo',note:'测试视觉演示，非口播转写',source:video,video,scenes:[{id:'a',start:0,end:1,title:'测试'}],elements:[{id:'a/title',sceneId:'a',name:'标题',description:'真实文字',production:'代码合成',box:[.1,.1,.8,.1],start:0,end:1}]};
 await assert.rejects(importDemo(engine,{...doc,elements:[{...doc.elements[0],box:[.9,.1,.8,.1]}]}),/区域无效/);
 const a=await importDemo(engine,doc),p=await engine.project(a.projectId);assert.equal(p.rough,null);assert.equal(p.sampleApproval,null);assert.equal(p.outputs[0].technicalCheck.audio,false);assert.equal((await engine.state()).tasks.length,0);
 await assert.rejects(engine.task(p.id,{type:'full'}),/审核通过/);
 const opinion=await engine.opinion(p.id,{context:'full',baseVersion:1,elementId:'a/title',start:0,end:1,scope:'scene',text:'标题改金色'}),task=await engine.task(p.id,{type:'revise',context:'full',opinionIds:[opinion.id]});await engine.taskStatus(task.id,'accept');
 await assert.rejects(importDemo(engine,{...doc,projectId:p.id,baseOutput:'wrong',taskId:task.id}),/基准版本/);
 const b=await importDemo(engine,{...doc,projectId:p.id,baseOutput:a.output.id,taskId:task.id});assert.equal(b.output.version,2);assert.equal((await engine.state()).tasks[0].status,'returned');assert.equal((await engine.project(p.id)).opinions[0].status,'returned');assert.equal((await engine.project(p.id)).sampleApproval,null);
});
