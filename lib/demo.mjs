// Host-rendered silent demonstrations retain provenance and real media checks.
// They never manufacture a transcript, rough-cut approval or sample approval.
import fs from 'node:fs/promises';
import path from 'node:path';
import {check,id,now,atomic} from './store.mjs';
import {probe,run,hashFile} from './media.mjs';
export async function importDemo(engine,doc) {
  check(doc.mode==='silent-visual-demo'&&typeof doc.note==='string'&&doc.note.trim(),'仅支持注明来源与用途的静音视觉演示',400);
  const info=await probe(doc.video,{decode:true});check(info.video&&!info.audio&&info.duration>0,'演示必须为真实可解码的静音视频',400);
  check(Array.isArray(doc.scenes)&&doc.scenes.length&&Array.isArray(doc.elements)&&doc.elements.length,'缺少分镜或可点选元素',400);
  let end=0;const ids=new Set();for(const c of doc.scenes){check(c.id&&!ids.has(c.id)&&Math.abs(c.start-end)<.03&&c.end>c.start&&c.title,'分镜须连续且有唯一ID和标题',400);end=c.end;ids.add(c.id);}check(Math.abs(end-info.duration)<.1,'分镜须覆盖真实演示时长',400);
  const eids=new Set();for(const e of doc.elements){check(e.id&&!eids.has(e.id)&&ids.has(e.sceneId)&&e.name&&e.description&&e.production&&e.start>=0&&e.end>e.start&&e.end<=info.duration+.03&&e.box?.length===4&&e.box.every(Number.isFinite)&&e.box[0]>=0&&e.box[1]>=0&&e.box[2]>0&&e.box[3]>0&&e.box[0]+e.box[2]<=1.001&&e.box[1]+e.box[3]<=1.001,'元素时间或点选区域无效',400);eids.add(e.id);}
  let p;
  if(doc.projectId){p=await engine.project(doc.projectId);if(!p.currentOutput){check(!p.rough&&!p.plan&&!doc.taskId&&!doc.baseOutput,'不能覆盖已有普通制作流程');check(await hashFile(p.assets.find(a=>a.id===p.speechId)?.path)===await hashFile(doc.source),'恢复导入的来源不同');}else{check(p.demo?.mode===doc.mode,'不能覆盖普通项目');check(p.currentOutput===doc.baseOutput,'基准版本已变化');const t=(await engine.state()).tasks.find(t=>t.id===doc.taskId&&t.projectId===p.id);check(t?.type==='revise'&&t.context==='full'&&['accepted','running'].includes(t.status),'先接收真实演示修改任务');engine.checkTask(p,t);}}
  else {check(!doc.taskId&&!doc.baseOutput,'新演示不能携带修改任务');const source=await probe(doc.source,{decode:true});check(source.video,'来源须为真实人物视频',400);p=await engine.create({templateId:'knowledge-sharing',name:doc.name||'静音视觉演示'});await engine.importAsset(p.id,doc.source,{role:'speech',kind:'video'});p=await engine.project(p.id);}
  const revision=p.assetRevision,base=p.currentOutput,oid=id('v'),folder=engine.folder(p.id,'renders',oid);await fs.mkdir(folder,{recursive:true});
  const video=path.join(folder,'video.mp4'),poster=path.join(folder,'poster.jpg');await fs.copyFile(doc.video,video);await run('ffmpeg',['-v','error','-y','-ss','0.5','-i',video,'-frames:v','1',poster]);check(await hashFile(video)===info.sha256,'导入期间视频变化');await atomic(path.join(folder,'provenance.json'),{...doc,imported:now(),sha256:info.sha256});
  return engine.store.transaction(s=>{
    const q=s.projects.find(q=>q.id===p.id);check(q.assetRevision===revision&&q.currentOutput===base,'项目在导入期间变化');
    if(doc.taskId){const t=s.tasks.find(t=>t.id===doc.taskId);check(['accepted','running'].includes(t?.status),'修改任务失效');engine.checkTask(q,t);check(!Object.values(q.drafts).some(d=>d.context==='full'&&d.text.trim()),'存在未提交草稿');}
    q.history.push({at:now(),plan:q.plan,currentOutput:q.currentOutput});q.demo={mode:doc.mode,note:doc.note,sourceRange:doc.sourceRange||null,sourceProject:doc.sourceProject||null};
    q.template={...q.template,id:'host-rendered-demo',version:1,origin:'宿主真实制作的演示项目',name:doc.templateName||'财经讲解 · 多布局演示',rules:{...q.template.rules,scope:doc.note,renderer:'host-rendered-demo'}};
    q.plan={duration:info.duration,version:(q.plan?.version||0)+1,scenes:doc.scenes,assetRevision:revision,source:'host-rendered-demo'};
    const out={id:oid,stage:'full',version:1+Math.max(0,...q.outputs.filter(o=>o.stage==='full').map(o=>o.version)),path:video,poster,duration:info.duration,contentDuration:info.duration,width:info.width,height:info.height,sha256:info.sha256,elements:doc.elements,assetRevision:revision,planVersion:q.plan.version,created:now(),origin:'host-rendered-demo',reviewNote:doc.note,technicalCheck:{decoded:true,video:true,audio:false}};
    q.outputs.push(out);q.currentOutput=oid;q.stage='full-review';q.sampleApproval=null;if(doc.taskId)engine.finishTask(q,s.tasks.find(t=>t.id===doc.taskId),{outputId:oid,path:video,version:out.version});return {projectId:q.id,output:out};
  });
}
