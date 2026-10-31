import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Engine} from '../lib/engine.mjs';
import {run,probe} from '../lib/media.mjs';
import {serve} from '../lib/server.mjs';
import {validateRough} from '../lib/schema.mjs';

async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'laodongcut-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const engine=await new Engine(path.join(dir,'data')).init();return {dir,engine};}
async function prepared(t,{duration=12,video=false}={}) {
  const env=await setup(t),{dir,engine}=env,file=path.join(dir,video?'source.mp4':'source.wav');
  const args=['-v','error','-y'];if(video)args.push('-f','lavfi','-i',`testsrc2=size=320x240:rate=30:duration=${duration}`);
  args.push('-f','lavfi','-i',`sine=frequency=440:sample_rate=48000:duration=${duration}`);if(video)args.push('-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac');args.push(file);await run('ffmpeg',args);
  const p=await engine.create({templateId:'knowledge-sharing',templateVersion:1,name:'自动测试：合成音频，不是真实转写'});await engine.importAsset(p.id,file,{role:'speech',kind:video?'video':'audio'});
  const task=await engine.task(p.id,{type:'start'});await engine.taskStatus(task.id,'accept');await engine.inspect(p.id);
  // Explicit test fixtures exercise the state machine; these captions do not claim ASR.
  const rough=await engine.rough(p.id,{transcriptSource:'user',note:'测试夹具，合成正弦音与示例文字',keep:[{start:0,end:duration}],cues:[{start:0,end:duration/2,text:'自动测试音频'},{start:duration/2,end:duration,text:'仅用于验证剪辑流程'}]});
  return {...env,p,task,rough,duration,file};
}
async function planned(t,options) {const env=await prepared(t,options),{engine,p,rough,task,duration}=env;await engine.confirmRough(p.id,rough.version,'自动化测试夹具：测试批准');await engine.plan(p.id,{scenes:[{id:'intro',start:0,end:duration/2,type:'steps',title:'验证真实制作流程',items:['素材保存','按自己的内容规划']},{id:'end',start:duration/2,end:duration,type:'focus',title:'先审核样片',items:['确认后再做完整版']}]},task.id);return env;}

test('已有模板直接进入素材页；复制任务不代表接收；重复创建不会重复派工',async t=>{
  const {engine,dir}=await setup(t);const p=await engine.create({templateId:'knowledge-sharing',templateVersion:1});assert.equal(p.stage,'materials');assert.equal(p.kind,'video');assert.equal(p.referenceId,null);
  await assert.rejects(engine.task(p.id,{type:'start'}),/讲解素材/);
  const file=path.join(dir,'fake.wav');await fs.writeFile(file,'saved does not mean valid');const a=await engine.importAsset(p.id,file,{role:'speech',kind:'audio'});assert.ok(path.isAbsolute(a.path));assert.equal(await fs.readFile(file,'utf8'),'saved does not mean valid');
  const task=await engine.task(p.id,{type:'start'}),again=await engine.task(p.id,{type:'start'});assert.equal(task.id,again.id);await engine.taskStatus(task.id,'copied');assert.equal((await engine.state()).tasks[0].status,'copied');await assert.rejects(engine.inspect(p.id),/ffprobe 执行失败/);assert.equal((await engine.project(p.id)).inspection,null);
});
test('粗剪区间和字幕必须合法，切点不能穿过一句话',()=>{
  assert.throws(()=>validateRough({transcriptSource:'user',keep:[{start:0,end:2},{start:1,end:4}],cues:[{start:0,end:1,text:'a'}]},4),/重叠/);
  assert.throws(()=>validateRough({transcriptSource:'user',keep:[{start:1,end:3}],cues:[{start:0,end:2,text:'a'}]},4),/穿过字幕/);
  const r=validateRough({transcriptSource:'user',keep:[{start:1,end:3},{start:5,end:7}],cues:[{start:1,end:2,text:'a'},{start:5,end:6,text:'b'}]},8);assert.equal(r.duration,4);assert.deepEqual(r.timeline.map(c=>c.start),[0,2]);
});
test('粗剪批准有版本；没有明确确认不能规划；新素材使任务和批准失效',async t=>{
  const {engine,p,task,rough,file}=await prepared(t,{duration:3});const plan={scenes:[{id:'a',start:0,end:3,type:'focus',title:'测试',items:[]}]};await assert.rejects(engine.plan(p.id,plan,task.id),/未经用户确认/);await assert.rejects(engine.confirmRough(p.id,rough.version+1,'测试确认'),/版本已变化/);await engine.confirmRough(p.id,rough.version,'测试批准');await engine.plan(p.id,plan,task.id);
  await engine.importAsset(p.id,file,{role:'speech',kind:'audio'});const updated=await engine.project(p.id);assert.equal(updated.plan,null);assert.equal(updated.rough,null);assert.equal(updated.sampleApproval,null);assert.equal((await engine.state()).tasks[0].status,'superseded');assert.ok(updated.history.length);
});
test('真实样片→草稿拦截→单条修改→版本审批→完整版→二次修改；模板快照保持隔离', {timeout:180000},async t=>{
  const {engine,p,task}=await planned(t);const sample=await engine.render(p.id,task.id);assert.equal(sample.stage,'sample');assert.ok(Math.abs(sample.duration-10)<.1);assert.ok(sample.elements.every(e=>e.end<=10));assert.equal((await probe(sample.path)).audio,true);await assert.rejects(engine.render(p.id,task.id),/已经执行/);await assert.rejects(engine.task(p.id,{type:'full'}),/审核通过/);
  const doc={key:'test-draft',context:'sample',baseVersion:sample.version,elementId:'intro/title',start:0,end:6,scope:'scene',text:'标题字号再大一点'};await engine.draft(p.id,doc);await assert.rejects(engine.approveSample(p.id,sample.id),/草稿/);
  const o=await engine.opinion(p.id,doc);const unrelated=await engine.opinion(p.id,{...doc,key:undefined,text:'其他片段稍后改',elementId:'end/title',start:6,end:10});
  const revise=await engine.task(p.id,{type:'revise',context:'sample',opinionIds:[o.id]});await engine.taskStatus(revise.id,'copied');assert.equal((await engine.project(p.id)).opinions[0].status,'copied');await engine.taskStatus(revise.id,'accept');
  const project=await engine.project(p.id),templateBefore=JSON.stringify(project.template),changed=structuredClone(project.plan);changed.scenes[0].overrides={titleSize:46};await engine.plan(p.id,changed,revise.id);const next=await engine.render(p.id,revise.id);assert.equal(next.version,2);const q=await engine.project(p.id);assert.equal(q.opinions.find(x=>x.id===o.id).status,'returned');assert.equal(q.opinions.find(x=>x.id===unrelated.id).status,'staged');assert.equal(JSON.stringify(q.template),templateBefore);assert.equal(q.sampleApproval,null);
  await assert.rejects(engine.approveSample(p.id,next.id),/意见/);await engine.dismissOpinion(p.id,unrelated.id,'测试用户撤回旧版本意见');await assert.rejects(engine.approveSample(p.id,sample.id),/当前有效/);await engine.approveSample(p.id,next.id);
  const fullTask=await engine.task(p.id,{type:'full'});await engine.taskStatus(fullTask.id,'accept');const full=await engine.render(p.id,fullTask.id);assert.ok(Math.abs(full.duration-12)<.1);assert.equal(full.stage,'full');assert.ok(full.elements.some(e=>e.end>10));assert.equal((await engine.verify(p.id)).video,true);
  const fo=await engine.opinion(p.id,{context:'full',baseVersion:full.version,elementId:'end/title',start:6,end:12,scope:'scene',text:'最后一段标题改小一点'});const ft=await engine.task(p.id,{type:'revise',context:'full',opinionIds:[fo.id]});await engine.taskStatus(ft.id,'accept');const finalPlan=structuredClone((await engine.project(p.id)).plan);finalPlan.scenes[1].overrides={titleSize:38};await engine.plan(p.id,finalPlan,ft.id);const revised=await engine.render(p.id,ft.id);assert.equal(revised.stage,'full');assert.equal(revised.version,2);assert.equal(JSON.stringify((await engine.project(p.id)).template),templateBefore);
});
test('短于10秒不补白；人物视频实际删除中间片段后声音与小窗同长', {timeout:180000},async t=>{
  const {engine,p,task}=await prepared(t,{duration:3,video:true});const rough=await engine.rough(p.id,{transcriptSource:'user',keep:[{start:0,end:.8},{start:1.8,end:3}],cues:[{start:0,end:.8,text:'测试前句'},{start:1.8,end:3,text:'测试后句'}]});await engine.confirmRough(p.id,rough.version,'测试批准：删除中间1秒');await engine.plan(p.id,{scenes:[{id:'a',start:0,end:2,type:'list',title:'同步裁切验证',items:['保留前句','保留后句']}]},task.id);const sample=await engine.render(p.id,task.id);assert.ok(Math.abs(sample.duration-2)<.1);assert.ok(sample.elements.some(e=>e.kind==='person'));const result=await probe(sample.path,{decode:true});assert.ok(result.audio&&result.video);const streams=JSON.parse((await run('ffprobe',['-v','error','-show_streams','-of','json',sample.path])).stdout).streams;assert.ok(Math.abs(Number(streams.find(s=>s.codec_type==='video').duration)-Number(streams.find(s=>s.codec_type==='audio').duration))<.05);
});
test('失败保留上一成片，任务可重试；素材变化时拒绝旧任务返回', {timeout:180000},async t=>{
  const {engine,p,task}=await planned(t,{duration:3});const sample=await engine.render(p.id,task.id);const o=await engine.opinion(p.id,{context:'sample',baseVersion:sample.version,elementId:'intro/title',start:0,end:1.5,scope:'scene',text:'需要先澄清的意见'});const task2=await engine.task(p.id,{type:'revise',context:'sample',opinionIds:[o.id]});await engine.taskStatus(task2.id,'accept');await engine.taskStatus(task2.id,'fail','测试失败');assert.equal((await engine.project(p.id)).currentOutput,sample.id);await engine.taskStatus(task2.id,'accept');assert.equal((await engine.state()).tasks.at(-1).attempt,2);await engine.recover(task2.id);assert.equal((await engine.state()).tasks.at(-1).status,'failed');
});
test('新参考必须有真实证据，模板意见不进入视频上下文，确认模板落盘且可复用',{timeout:180000},async t=>{
  const {engine,dir}=await setup(t),video=path.join(dir,'ref.mp4');await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=blue:s=360x640:r=24:d=1','-c:v','libx264','-pix_fmt','yuv420p',video]);const p=await engine.create({});await engine.importAsset(p.id,video,{role:'reference',kind:'video'});const task=await engine.task(p.id,{type:'analyze'});await engine.taskStatus(task.id,'accept');const rules=(await engine.state()).templates[0].versions[0].rules;
  const doc={rules,scenes:[{id:'reference',start:0,end:1,title:'纯蓝背景'}],observations:['测试参考为纯蓝底，没有文字。'],inferences:['代码布局仅为建议，非从画面恢复。'],elements:[{id:'background',name:'背景',description:'真实蓝底',production:'代码可以直接做好',box:[0,0,1,1],start:0,end:1}]};await assert.rejects(engine.analysis(p.id,doc,task.id),/真实参考证据/);const evidence=await engine.inspect(p.id);assert.equal(evidence.scenes[0].frames.length,3);await engine.analysis(p.id,doc,task.id);
  const o=await engine.opinion(p.id,{context:'template',baseVersion:1,elementId:'background',start:0,end:1,scope:'scene',text:'把模板背景调整为蓝色'});await assert.rejects(engine.task(p.id,{type:'revise',context:'sample',opinionIds:[o.id]}),/没有可修改/);const rt=await engine.task(p.id,{type:'revise',context:'template',opinionIds:[o.id]});await engine.taskStatus(rt.id,'accept');const updated=structuredClone(doc);updated.rules.palette.background='#0000FF';await engine.analysis(p.id,updated,rt.id);const saved=await engine.confirmTemplate(p.id,'真实证据测试模板'),own=await engine.create({templateId:saved.templateId});assert.equal(own.stage,'materials');assert.equal(own.template.rules.palette.background,'#0000FF');assert.equal(own.opinions.length,0);const second=await engine.confirmTemplate(p.id);assert.equal(second.version,1);assert.ok(await fs.stat(path.join(engine.root,'templates',saved.templateId,'v1.json')));
});
test('本地服务上传落盘、断言来源、视频范围请求、拒绝越界文件；重启可恢复',async t=>{
  const {engine}=await setup(t),server=await serve(engine,{port:0});t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));const url=`http://127.0.0.1:${server.address().port}`,session=await(await fetch(url+'/api/session')).json(),headers={'X-Laodongcut-Token':session.token,'Content-Type':'application/json'};
  const denied=await fetch(url+'/api/projects',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'});assert.equal(denied.status,403);assert.equal((await fetch(url+'/api/projects',{method:'POST',body:'{}'})).status,403);
  const p=await(await fetch(url+'/api/projects',{method:'POST',headers,body:JSON.stringify({templateId:'knowledge-sharing',templateVersion:1})})).json();const uploaded=await fetch(`${url}/api/projects/${p.id}/assets?role=speech&kind=audio&revision=0`,{method:'POST',headers:{'X-Laodongcut-Token':session.token,'X-File-Name':encodeURIComponent('中文录音.wav')},body:'wave-body'});assert.equal(uploaded.status,201);const asset=await uploaded.json();assert.ok(path.isAbsolute(asset.path));assert.equal(await fs.readFile(asset.path,'utf8'),'wave-body');assert.equal(asset.name,'中文录音.wav');
  const ranged=await fetch(url+'/media?path='+encodeURIComponent(asset.path),{headers:{Range:'bytes=0-3'}});assert.equal(ranged.status,206);assert.equal(await ranged.text(),'wave');assert.equal((await fetch(url+'/media?path='+encodeURIComponent(path.join(engine.root,'state.json')))).status,403);const restored=await new Engine(engine.root).init();assert.equal((await restored.project(p.id)).speechId,asset.id);
  assert.equal((await restored.project(p.id)).uploads[0].status,'saved');
});
test('图片与B-roll真实合成；补自定义素材保留粗剪确认并使旧任务失效',{timeout:180000},async t=>{
  const {engine,p,task,rough,dir}=await prepared(t,{duration:4,video:true});await engine.confirmRough(p.id,rough.version,'测试批准');
  const image=path.join(dir,'image.png'),broll=path.join(dir,'broll.mp4');await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=red:s=320x240','-frames:v','1',image]);await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x240:r=24:d=1','-c:v','libx264','-pix_fmt','yuv420p',broll]);
  const a=await engine.importAsset(p.id,image,{role:'custom',kind:'image'}),b=await engine.importAsset(p.id,broll,{role:'custom',kind:'video'});assert.equal((await engine.project(p.id)).rough.confirmed,true);assert.equal((await engine.state()).tasks.find(t=>t.id===task.id).status,'superseded');await assert.rejects(engine.taskStatus(task.id,'accept'),/旧素材/);
  const nt=await engine.task(p.id,{type:'start'});await engine.taskStatus(nt.id,'accept');await engine.plan(p.id,{scenes:[{id:'image',start:0,end:2,type:'media',title:'图片与人物',items:['红色图片'],assetId:a.id},{id:'broll',start:2,end:4,type:'media',title:'视频与人物',items:['测试B-roll'],assetId:b.id}]},nt.id);const result=await engine.render(p.id,nt.id);assert.equal(result.media.length,2);assert.ok(result.elements.some(e=>e.kind==='media'));assert.ok(Math.abs(result.duration-4)<.1);
});
test('取消未执行任务保留意见；旧版本草稿可显式撤回；变更素材释放旧意见状态',{timeout:180000},async t=>{
  const {engine,p,task,file}=await planned(t,{duration:3});const sample=await engine.render(p.id,task.id);const doc={context:'sample',baseVersion:sample.version,elementId:'intro/title',start:0,end:1.5,scope:'scene',text:'测试修改'};
  const o1=await engine.opinion(p.id,doc),o2=await engine.opinion(p.id,{...doc,text:'第二条'}),rt=await engine.task(p.id,{type:'revise',context:'sample',opinionIds:[o1.id,o2.id]});await engine.taskStatus(rt.id,'copied');await engine.dismissOpinion(p.id,o1.id,'撤回一条');assert.equal((await engine.project(p.id)).opinions.find(o=>o.id===o2.id).status,'staged');const next=await engine.task(p.id,{type:'revise',context:'sample',opinionIds:[o2.id]});await engine.cancelTask(next.id,'验收取消');assert.equal((await engine.project(p.id)).opinions.find(o=>o.id===o2.id).status,'staged');
  await engine.draft(p.id,{...doc,key:'old-draft'});const retry=await engine.task(p.id,{type:'revise',context:'sample',opinionIds:[o2.id]});await engine.taskStatus(retry.id,'accept');await engine.importAsset(p.id,file,{role:'speech',kind:'audio'});assert.equal((await engine.project(p.id)).opinions.find(o=>o.id===o2.id).status,'staged');await engine.discardDraft(p.id,'old-draft');assert.equal(Object.keys((await engine.project(p.id)).drafts).length,0);
});
test('完整版渲染期间新增样片草稿会使批准失效，不能登记为成功；取消后可以继续审核',{timeout:180000},async t=>{
  const {engine,p,task}=await planned(t),sample=await engine.render(p.id,task.id);await engine.approveSample(p.id,sample.id);const ft=await engine.task(p.id,{type:'full'});await engine.taskStatus(ft.id,'accept');
  const work=engine.render(p.id,ft.id).then(value=>({value}),error=>({error}));
  for(let i=0;i<100;i++){if((await engine.state()).tasks.find(t=>t.id===ft.id).status==='rendering')break;await new Promise(r=>setTimeout(r,5));}
  await engine.draft(p.id,{key:'during-render',context:'sample',baseVersion:sample.version,elementId:'intro/title',start:0,end:6,scope:'scene',text:'渲染期间新增的修改'});const result=await work;assert.match(result.error?.message||'',/批准已失效/);assert.equal((await engine.project(p.id)).currentOutput,sample.id);await engine.cancelTask(ft.id,'先处理新意见');await engine.discardDraft(p.id,'during-render');await engine.approveSample(p.id,sample.id);assert.equal((await engine.project(p.id)).sampleApproval.outputId,sample.id);
});

test('全局意见复用修改流程，覆盖整片并使样片批准失效',{timeout:180000},async t=>{
  const {engine,p,task}=await planned(t,{duration:12});const out=await engine.render(p.id,task.id);
  await engine.approveSample(p.id,out.id);
  const doc={context:'sample',baseVersion:out.version,elementId:null,start:0,end:12,scope:'video',text:'所有插画统一手绘风格'};
  await engine.draft(p.id,{...doc,key:'global-test'});assert.equal((await engine.project(p.id)).sampleApproval,null);
  const opinion=await engine.opinion(p.id,{...doc,key:'global-test'});assert.equal(opinion.elementId,null);assert.equal(opinion.end,12);assert.equal((await engine.project(p.id)).drafts['global-test'],undefined);
  const change=await engine.task(p.id,{type:'revise',context:'sample',opinionIds:[opinion.id]});assert.deepEqual(change.opinionIds,[opinion.id]);
  await assert.rejects(engine.opinion(p.id,{...doc,end:10}),/覆盖整个视频/);
  await assert.rejects(engine.opinion(p.id,{...doc,elementId:'intro/title'}),/全局意见/);
  await assert.rejects(engine.opinion(p.id,{...doc,scope:'scene',end:10}),/元素不存在/);
});
