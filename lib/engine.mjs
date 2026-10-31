import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store, id, now, check, atomic, inside} from './store.mjs';
import {inspectSpeech, inspectReference, hashFile, probe} from './media.mjs';
import {validateRules, validateRough, validatePlan} from './schema.mjs';
import {renderVideo} from './render.mjs';

export const bundle=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const active=t=>['queued','copied','accepted','running','rendering','failed'].includes(t.status);
const openOpinion=o=>!['returned','dismissed'].includes(o.status);
const findProject=(s,pid)=>{const p=s.projects.find(p=>p.id===pid);check(p,'找不到项目',404);return p;};
const currentVersion=(p,context)=>context==='template'?p.analysis?.version:p.outputs.find(o=>o.id===p.currentOutput&&o.stage===context)?.version;
const draftPending=(p,ctx)=>Object.values(p.drafts).some(d=>d.context===ctx&&d.text.trim());
const pending=(p,ctx)=>p.opinions.some(o=>o.context===ctx&&openOpinion(o))||draftPending(p,ctx);
function invalidate(p,s,reason,preserveSpeech=false) {
  if(p.rough||p.plan||p.currentOutput) p.history.push({at:now(),reason,rough:p.rough,plan:p.plan,currentOutput:p.currentOutput});
  p.assetRevision++;
  if(preserveSpeech&&p.inspection){p.inspection.assetRevision=p.assetRevision;if(p.rough)p.rough.assetRevision=p.assetRevision;}else{p.inspection=null;p.rough=null;}
  p.plan=null;p.sampleApproval=null;p.currentOutput=null;p.stage=p.kind==='reference'?'reference-ready':p.rough?.confirmed?'planning':p.rough?'rough-review':'materials';
  for(const t of s.tasks.filter(t=>t.projectId===p.id&&active(t))) {t.status='superseded';for(const oid of t.opinionIds){const o=p.opinions.find(o=>o.id===oid);if(o&&openOpinion(o)){o.status='staged';o.staleReason=reason;}}}
}
function snapshot(p) {
  return {assetRevision:p.assetRevision,roughVersion:p.rough?.version,planVersion:p.plan?.version,analysisVersion:p.analysis?.version,currentOutput:p.currentOutput};
}
function assertSnapshot(p,snap) {check(JSON.stringify(snapshot(p))===JSON.stringify(snap),'项目已变化，结果不再对应当前素材或版本；请重新接收任务。');}
function validateAnalysis(doc,p) {
  validateRules(doc.rules);
  check(p.evidence?.scenes?.length,'必须先提取真实参考证据');
  check(Array.isArray(doc.observations)&&doc.observations.length&&Array.isArray(doc.inferences),'请分别填写观察事实和推断结构',400);
  check(Array.isArray(doc.scenes)&&doc.scenes.length>0,'请按真实画面变化返回参考片段；不要把定时取帧间隔当作切镜',400);
  let previous=0;const sceneIds=new Set();
  for(const scene of doc.scenes){check(typeof scene.id==='string'&&!sceneIds.has(scene.id)&&Number.isFinite(scene.start)&&Number.isFinite(scene.end)&&Math.abs(scene.start-previous)<.03&&scene.end>scene.start&&scene.end<=p.evidence.duration+.03,'参考片段ID重复、时间不连续或越界',400);sceneIds.add(scene.id);previous=scene.end;}
  check(Math.abs(previous-p.evidence.duration)<.03,'参考片段必须覆盖原片真实时长',400);
  check(Array.isArray(doc.elements)&&doc.elements.length>0,'缺少可点选元素',400);
  const ids=new Set();
  for(const e of doc.elements) {
    check(typeof e.id==='string'&&!ids.has(e.id)&&e.name&&e.description&&e.production,'元素缺少唯一标识、说明或生产方式',400);ids.add(e.id);
    check(Array.isArray(e.box)&&e.box.length===4&&e.box.every(Number.isFinite)&&e.box[0]>=0&&e.box[1]>=0&&e.box[2]>0&&e.box[3]>0&&e.box[0]+e.box[2]<=1.001&&e.box[1]+e.box[3]<=1.001,'元素框必须位于画面内',400);
    check(Number.isFinite(e.start)&&Number.isFinite(e.end)&&e.start>=0&&e.end>e.start&&e.end<=p.evidence.duration+.03,'元素时间越界',400);
  }
  return doc;
}
export class Engine {
  constructor(root) {this.store=new Store(root);this.root=this.store.root;}
  async init() {const t=JSON.parse(await fs.readFile(path.join(bundle,'templates','knowledge.json'),'utf8'));await this.store.init(t);await this.store.transaction(async s=>{for(const p of s.projects){p.uploads||=[];for(const u of p.uploads.filter(u=>u.status==='uploading')){let stopped=false;try{process.kill(u.pid,0);}catch(e){stopped=e.code==='ESRCH';}if(stopped){u.status='failed';u.error='上次上传进程已停止，请重新选择文件重试';if(inside(this.folder(p.id,'assets'),u.temp))await fs.rm(u.temp,{force:true});}}}});return this;}
  async state() {return this.store.read();}
  async upgradeBuiltin(pid,reason) {
    check(typeof reason==='string'&&reason.trim(),'需要记录用户要求升级模板的原意');
    return this.store.transaction(s=>{const p=findProject(s,pid),t=s.templates.find(t=>t.id==='knowledge-sharing');
      check(p.template?.id===t?.id,'仅升级内置模板项目');check(!s.tasks.some(t=>t.projectId===pid&&active(t)),'先结束当前任务再升级');
      if(p.template.version===t.current)return p.template;
      p.history.push({at:now(),reason,template:structuredClone(p.template),plan:p.plan,currentOutput:p.currentOutput});
      p.template={id:t.id,name:t.name,...structuredClone(t.versions.find(v=>v.version===t.current))};p.plan=null;p.sampleApproval=null;return p.template;
    });
  }
  async project(pid) {return findProject(await this.state(),pid);}
  folder(pid,...parts) {check(/^p-[a-f\d-]{36}$/.test(pid),'项目ID无效',400);return path.join(this.root,'projects',pid,...parts);}
  async create({templateId,templateVersion,name}) {
    return this.store.transaction(async s=>{
      let template=null;
      if(templateId) {const t=s.templates.find(t=>t.id===templateId);check(t,'模板不存在',404);const v=t.versions.find(v=>v.version===(templateVersion??t.current));check(v?.confirmed,'模板版本不存在或尚未确认');template={id:t.id,name:t.name,...structuredClone(v)};}
      const p={id:id('p'),name:name||`我的视频 ${new Date().toLocaleString('zh-CN')}`,created:now(),kind:template?'video':'reference',stage:template?'materials':'reference-ready',assetRevision:0,assets:[],uploads:[],speechId:null,referenceId:null,template,analysis:null,evidence:null,inspection:null,rough:null,plan:null,outputs:[],currentOutput:null,sampleApproval:null,opinions:[],drafts:{},history:[]};
      await fs.mkdir(this.folder(p.id,'assets'),{recursive:true});s.projects.push(p);return p;
    });
  }
  async register(pid,file,{name,role,kind,expectedRevision}) {
    check(inside(this.folder(pid,'assets'),file),'素材必须先保存在本项目目录',400);
    const stat=await fs.stat(file);check(stat.isFile()&&stat.size>0&&stat.size<=500*1024*1024,'素材为空或超过500 MB',400);
    check(['speech','custom','reference'].includes(role)&&['audio','video','image'].includes(kind),'素材类别无效',400);
    check(role!=='reference'||kind==='video','参考素材必须为视频',400);
    check(role!=='speech'||['audio','video'].includes(kind),'讲解素材应为录音或口播视频',400);
    return this.store.transaction(s=>{
      const p=findProject(s,pid);if(expectedRevision!==undefined)check(p.assetRevision===expectedRevision,'素材已被其他窗口更换，请刷新后重试');
      check(role==='reference'?p.kind==='reference':p.kind==='video','当前页面不能添加这种素材');
      const a={id:id('a'),name:String(name||path.basename(file)).slice(0,200),path:path.resolve(file),role,kind,size:stat.size,uploadStatus:'saved',created:now()};
      p.assets.push(a);invalidate(p,s,'素材更换或补充',role==='custom');
      if(role==='speech')p.speechId=a.id;
      if(role==='reference'){p.referenceId=a.id;p.analysis=null;p.evidence=null;}
      return a;
    });
  }
  async importAsset(pid,source,opts) {
    await this.project(pid);const stat=await fs.stat(source);check(stat.isFile()&&stat.size<=500*1024*1024,'素材必须为不超过500 MB的文件',400);
    const name=path.basename(source), dest=this.folder(pid,'assets',`${id('file')}${path.extname(name).replace(/[^.a-z\d]/gi,'')}`);
    await fs.copyFile(source,dest,1);
    try{return await this.register(pid,dest,{...opts,name});}catch(e){await fs.rm(dest,{force:true});throw e;}
  }
  async uploadStart(pid,name,temp) {return this.store.transaction(s=>{const p=findProject(s,pid),u={id:id('upload'),name,temp,status:'uploading',pid:process.pid,created:now()};p.uploads||=[];p.uploads.push(u);return u;});}
  async uploadEnd(pid,uid,{assetId,error}) {return this.store.transaction(s=>{const p=findProject(s,pid),u=p.uploads.find(u=>u.id===uid);check(u,'上传记录不存在');u.status=error?'failed':'saved';u.error=error||null;u.assetId=assetId||null;u.updated=now();return u;});}
  async inspect(pid) {
    const p=await this.project(pid),snap=snapshot(p),aid=p.kind==='reference'?p.referenceId:p.speechId,a=p.assets.find(a=>a.id===aid);
    check(a,'请先保存真实参考视频或讲解素材',400);
    const result=p.kind==='reference'?await inspectReference(a,this.folder(pid,'evidence',`assets-${p.assetRevision}`)):await inspectSpeech(a,this.folder(pid,'inspection',`assets-${p.assetRevision}`));
    return this.store.transaction(s=>{const q=findProject(s,pid);assertSnapshot(q,snap);if(p.kind==='reference'){q.evidence=result;q.stage='analysis-waiting';}else{q.inspection={...result,assetRevision:q.assetRevision};q.stage='rough-review';}return result;});
  }
  async rough(pid,doc) {
    return this.store.transaction(s=>{const p=findProject(s,pid);check(p.inspection?.assetRevision===p.assetRevision,'先检查当前素材');
      const rough=validateRough(doc,p.inspection.duration);p.history.push({at:now(),rough:p.rough,plan:p.plan,currentOutput:p.currentOutput});
      p.rough={...rough,version:(p.rough?.version||0)+1,confirmed:false,assetRevision:p.assetRevision};p.plan=null;p.currentOutput=null;p.sampleApproval=null;p.stage='rough-review';return p.rough;});
  }
  async confirmRough(pid,version,confirmation) {
    check(typeof confirmation==='string'&&confirmation.trim(),'必须记录用户在对话中的明确粗剪确认原话',400);
    return this.store.transaction(s=>{const p=findProject(s,pid);check(p.rough?.version===version&&p.rough.assetRevision===p.assetRevision,'粗剪版本已变化');p.rough.confirmed=true;p.rough.confirmation={text:confirmation,at:now()};p.stage='planning';return p.rough;});
  }
  async plan(pid,doc,taskId) {
    return this.store.transaction(s=>{const p=findProject(s,pid);check(p.rough?.confirmed&&p.rough.assetRevision===p.assetRevision,'当前粗剪未经用户确认');
      const task=s.tasks.find(t=>t.id===taskId&&t.projectId===pid);check(task&&['accepted','running'].includes(task.status),'先接收制作或修改任务');this.checkTask(p,task);
      check(['start','revise'].includes(task.type)&&task.context!=='template','任务不接受画面规划');
      if(task.type==='revise')check(!draftPending(p,task.context),'请先处理未提交的修改草稿');
      const plan=validatePlan(doc,p);p.history.push({at:now(),plan:p.plan,currentOutput:p.currentOutput});p.plan={...plan,version:(p.plan?.version||0)+1,assetRevision:p.assetRevision,roughVersion:p.rough.version,taskId};p.sampleApproval=null;p.stage='render-ready';task.planVersion=p.plan.version;task.status='running';return p.plan;});
  }
  checkTask(p,t) {
    check(t.assetRevision===p.assetRevision,'任务依赖旧素材，不能执行');
    if(t.type==='revise')check(currentVersion(p,t.context)===t.baseVersion,'意见基准版本与当前结果不同，需要重新定位');
  }
  async task(pid,{type,context,opinionIds=[]}) {
    check(['analyze','start','revise','full'].includes(type),'任务类型无效',400);
    return this.store.transaction(async s=>{
      const p=findProject(s,pid);
      if(type==='analyze'){check(p.kind==='reference'&&p.referenceId,'请先上传参考视频');context='template';}
      if(type==='start'){check(p.template&&p.speechId,'请先选择模板和保存讲解素材');context='sample';check(!p.currentOutput,'已有视频，请通过修改意见创建下一版本');}
      if(type==='full'){check(p.sampleApproval?.outputId===p.currentOutput&&p.sampleApproval.assetRevision===p.assetRevision,'必须先明确审核通过当前样片版本');check(!pending(p,'sample'),'有未处理意见或未提交草稿');context='full';}
      check(['template','sample','full'].includes(context),'修改上下文无效',400);
      const baseVersion=(type==='full'?p.outputs.find(o=>o.id===p.currentOutput)?.version:currentVersion(p,context))??null;
      const duplicate=s.tasks.find(t=>t.projectId===pid&&t.type===type&&t.context===context&&t.assetRevision===p.assetRevision&&t.baseVersion===baseVersion&&active(t)&&JSON.stringify(t.opinionIds)===JSON.stringify(opinionIds));
      if(duplicate)return duplicate;
      check(!s.tasks.some(t=>t.projectId===pid&&active(t)),'当前项目已有未返回任务，请先完成、重试或撤回该任务对应的意见');
      if(type==='revise') {
        check(baseVersion,'当前上下文还没有可修改的结果');check(opinionIds.length>0,'没有待修改意见',400);
        for(const oid of opinionIds){const o=p.opinions.find(o=>o.id===oid);check(o&&o.context===context&&o.baseVersion===baseVersion&&openOpinion(o),'意见上下文或基准版本不匹配');check(!s.tasks.some(t=>t.projectId===pid&&active(t)&&t.status!=='failed'&&t.opinionIds.includes(oid)),'意见已在其他任务中');}
        p.sampleApproval=null;
      }
      const t={id:id('t'),projectId:pid,type,context,baseVersion:baseVersion??null,assetRevision:p.assetRevision,templateId:p.template?.id,templateVersion:p.template?.version,opinionIds,status:'queued',created:now(),attempt:0};
      t.requestPath=path.join(this.root,'tasks',t.id,'request.json');t.prompt=this.prompt(p,t);
      await atomic(t.requestPath,{...t,projectPath:this.store.file,project:structuredClone(p),instructions:t.prompt});
      s.tasks.push(t);if(type==='start'||type==='full')p.stage=`${context}-waiting`;return t;
    });
  }
  prompt(p,t) {
    return `使用 $laodongcut，在当前对话执行真实任务，不虚构结果。\nSkill：${path.join(bundle,'SKILL.md')}\n数据目录：${this.root}\n项目 ID：${p.id}\n任务 ID：${t.id}\n任务文件：${t.requestPath}\n任务：${t.type}；目标：${t.context}；基准版本：${t.baseVersion??'尚无结果'}；素材修订：${p.assetRevision}\n模板：${p.template?.id||'待拆解'} / v${p.template?.version||'待确认'}\n讲解：${p.assets.find(a=>a.id===p.speechId)?.kind||'待提供'} / ${p.assets.find(a=>a.id===p.speechId)?.path||'无'}\n参考：${p.assets.find(a=>a.id===p.referenceId)?.path||'无'}\n自定义素材：\n${p.assets.filter(a=>a.role==='custom').map(a=>a.path).join('\n')||'暂无'}\n\n先读取任务文件，再使用 scripts/cli.mjs accept ${t.id}。${t.type==='analyze'?'提取真实参考关键帧，区分观察、推断和实现建议，回传 analysis。':t.type==='start'?'检查媒体并获得真实逐句转写，提出粗剪建议，等待我在当前对话确认；确认后规划符合模板的新画面并只渲染前10秒。':t.type==='full'?'当前样片已绑定版本通过。延续已确认的规划渲染完整版，再回传页面审核。':'按任务中的意见逐条处理；冲突先在当前对话澄清，修改后回传可验证的新版本，不把复制当作完成。'}\n所有命令使用同一 --data 数据目录。不得自动发到其他对话。`;
  }
  async taskStatus(tid,action,error) {
    return this.store.transaction(s=>{
      const t=s.tasks.find(t=>t.id===tid);check(t,'任务不存在',404);const p=findProject(s,t.projectId);this.checkTask(p,t);
      if(action==='copied'){check(['queued','copied'].includes(t.status),'任务已被接收');t.status='copied';}
      else if(action==='accept'){check(['queued','copied','failed'].includes(t.status),'任务已接收或结束，请勿重复执行');t.status='accepted';t.attempt++;t.error=null;}
      else if(action==='fail'){check(['accepted','running','rendering'].includes(t.status),'任务未执行');t.status='failed';t.error=String(error||'执行失败').slice(0,5000);p.stage='failed';}
      else check(false,'未知状态操作',400);
      t.updated=now();for(const oid of t.opinionIds){const o=p.opinions.find(o=>o.id===oid);if(o)o.status=t.status;}
      return t;
    });
  }
  async analysis(pid,doc,taskId) {
    return this.store.transaction(s=>{const p=findProject(s,pid),t=s.tasks.find(t=>t.id===taskId&&t.projectId===pid);check(t&&['accepted','running'].includes(t.status)&&t.context==='template','先接收模板任务');this.checkTask(p,t);validateAnalysis(doc,p);
      check(!draftPending(p,'template'),'还有未提交的模板修改草稿');
      p.analysis={...doc,version:(p.analysis?.version||0)+1,confirmed:false};p.stage='analysis-review';this.finishTask(p,t,{analysisVersion:p.analysis.version});return p.analysis;});
  }
  finishTask(p,t,result) {t.status='returned';t.result=result;t.updated=now();for(const oid of t.opinionIds){const o=p.opinions.find(o=>o.id===oid);if(o){o.status='returned';o.result=result;}}}
  async confirmTemplate(pid,name) {
    return this.store.transaction(async s=>{const p=findProject(s,pid);check(p.analysis&&!pending(p,'template'),'先处理模板意见及草稿');check(!s.tasks.some(t=>t.projectId===pid&&t.context==='template'&&active(t)),'模板还有未完成任务');
      let t=s.templates.find(t=>t.id===p.savedTemplateId);
      if(!t){t={id:id('template'),name:name||`拆解模板 ${new Date().toLocaleString('zh-CN')}`,current:0,versions:[]};s.templates.push(t);p.savedTemplateId=t.id;}
      if(!p.analysis.confirmed){const v={version:t.current+1,confirmed:true,created:now(),origin:'用户确认的参考视频拆解',rules:structuredClone(p.analysis.rules),observations:p.analysis.observations,inferences:p.analysis.inferences};t.versions.push(v);t.current=v.version;p.analysis.confirmed=true;await atomic(path.join(this.root,'templates',t.id,`v${v.version}.json`),{id:t.id,name:t.name,...v});}
      return {templateId:t.id,version:t.current};});
  }
  async renameTemplate(tid,name) {check(typeof name==='string'&&name.trim()&&name.length<=120,'模板名称不能为空或超过120字',400);return this.store.transaction(s=>{const t=s.templates.find(t=>t.id===tid);check(t,'模板不存在',404);t.name=name.trim();return t;});}
  async draft(pid,{key,context,baseVersion,elementId,start,end,scope,text}) {
    check(typeof key==='string'&&key.length<300&&typeof text==='string'&&text.length<=4000,'草稿无效',400);
    check(['template','sample','full'].includes(context),'草稿上下文无效',400);
    return this.store.transaction(s=>{const p=findProject(s,pid);check(currentVersion(p,context)===baseVersion,'画面版本变化，请刷新后重新定位');p.drafts[key]={key,context,baseVersion,elementId,start,end,scope,text};if(context==='sample'&&text.trim())p.sampleApproval=null;return p.drafts[key];});
  }
  async opinion(pid,doc) {
    return this.store.transaction(s=>{const p=findProject(s,pid),{context,baseVersion,elementId,start,end,scope,text}=doc;
      check(currentVersion(p,context)===baseVersion,'意见基准版本已变化，请重新定位');
      const output=p.outputs.find(o=>o.id===p.currentOutput),elements=context==='template'?p.analysis.elements:output?.elements;
        const global=scope==='video';
        check(global?elementId==null:elements?.some(e=>e.id===elementId),'选中元素不存在，或全局意见不应指定元素',400);
        const duration=context==='template'?p.evidence.duration:global?(p.rough?.duration||p.plan?.duration||output.duration):output.duration;
      check(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&end<=duration+.03,'意见时间超出当前审核范围',400);
        check(['scene','all','video'].includes(scope)&&typeof text==='string'&&text.trim()&&text.length<=4000,'意见内容或范围无效',400);
        if(global)check(start===0&&Math.abs(end-duration)<.03,'全局意见须覆盖整个视频',400);
      const o={id:id('o'),projectId:pid,templateId:p.template?.id||p.savedTemplateId||null,templateVersion:p.template?.version||null,context,baseVersion,elementId,start,end,scope,text:text.trim(),status:'staged',created:now()};p.opinions.push(o);if(doc.key)delete p.drafts[doc.key];if(context==='sample')p.sampleApproval=null;return o;
    });
  }
  async dismissOpinion(pid,oid,reason) {check(reason?.trim(),'需要说明移除原因',400);return this.store.transaction(s=>{const p=findProject(s,pid),o=p.opinions.find(o=>o.id===oid);check(o&&['staged','copied','failed'].includes(o.status),'意见已执行或执行中');check(!s.tasks.some(t=>t.projectId===pid&&['accepted','running','rendering'].includes(t.status)&&t.opinionIds.includes(oid)),'意见已被接收');for(const t of s.tasks.filter(t=>t.projectId===pid&&active(t)&&t.opinionIds.includes(oid))){t.status='superseded';for(const oid2 of t.opinionIds){const other=p.opinions.find(x=>x.id===oid2);if(other&&openOpinion(other))other.status='staged';}}o.status='dismissed';o.dismissReason=reason;return o;});}
  async cancelTask(tid,reason) {check(reason?.trim(),'需要记录取消原因',400);return this.store.transaction(s=>{const t=s.tasks.find(t=>t.id===tid);check(t&&['queued','copied','failed'].includes(t.status),'执行中的任务需先确认旧进程停止并 recover');t.status='cancelled';t.cancelReason=reason;const p=findProject(s,t.projectId);for(const oid of t.opinionIds){const o=p.opinions.find(o=>o.id===oid);if(o&&openOpinion(o))o.status='staged';}p.stage=p.currentOutput?`${p.outputs.find(o=>o.id===p.currentOutput).stage}-review`:p.kind==='reference'?'reference-ready':'materials';return t;});}
  async discardDraft(pid,key) {return this.store.transaction(s=>{const p=findProject(s,pid);check(p.drafts[key],'草稿不存在',404);p.history.push({at:now(),reason:'用户撤回修改草稿',draft:p.drafts[key]});delete p.drafts[key];return {removed:true};});}
  async approveSample(pid,outputId) {
    return this.store.transaction(s=>{const p=findProject(s,pid),o=p.outputs.find(o=>o.id===outputId);check(o?.stage==='sample'&&p.currentOutput===outputId&&o.assetRevision===p.assetRevision,'只允许审核当前有效样片');check(!pending(p,'sample'),'先处理样片意见及草稿');check(!s.tasks.some(t=>t.projectId===pid&&active(t)),'还有未完成任务');p.sampleApproval={outputId,assetRevision:p.assetRevision,planVersion:p.plan.version,at:now()};p.stage='sample-approved';return p.sampleApproval;});
  }
  async render(pid,tid) {
    const job=await this.store.transaction(s=>{
      const p=findProject(s,pid),t=s.tasks.find(t=>t.id===tid&&t.projectId===pid);check(t&&['accepted','running'].includes(t.status),'任务未接收或已经执行');this.checkTask(p,t);
      check(p.plan&&p.rough?.confirmed&&p.plan.assetRevision===p.assetRevision&&p.plan.roughVersion===p.rough.version,'需要当前素材的已确认粗剪和画面规划');
      check(t.context!=='template','模板任务不能渲染视频');
      if(t.type==='full')check(p.sampleApproval?.outputId===p.currentOutput&&p.sampleApproval.planVersion===p.plan.version&&!pending(p,'sample'),'当前样片批准已失效');
      else check(p.plan.taskId===tid,'规划不属于当前任务');
      check(!draftPending(p,t.context),'有未提交草稿，先处理再渲染');
      t.status='rendering';p.stage='rendering';for(const oid of t.opinionIds)p.opinions.find(o=>o.id===oid).status='running';
      return {project:structuredClone(p),task:structuredClone(t),snap:snapshot(p),outputId:id('v')};
    });
    try {
      const speech=job.project.assets.find(a=>a.id===job.project.speechId);
      check(await hashFile(speech.path)===job.project.inspection.sha256,'讲解文件内容已变化，请重新上传并初检');
      const out=await renderVideo(job.project,job.task.context,this.folder(pid,'renders',job.outputId));
      await atomic(this.folder(pid,'renders',job.outputId,'result.json'),{...out,taskId:tid,projectId:pid});
      return await this.store.transaction(s=>{const p=findProject(s,pid),t=s.tasks.find(t=>t.id===tid);check(t.status==='rendering','任务已失效，保留渲染文件供检查');assertSnapshot(p,job.snap);
        // Edits made while rendering must be reviewed before a result can close its task.
        check(!draftPending(p,t.context),'渲染期间新增了修改草稿；先处理草稿，再重试任务');
        if(t.type==='full')check(p.sampleApproval?.outputId===job.snap.currentOutput&&!pending(p,'sample'),'渲染期间样片批准已失效；结果保留在渲染目录，不登记为已审核流程的完整版');
        const output={...out,id:job.outputId,stage:t.context,version:1+Math.max(0,...p.outputs.filter(o=>o.stage===t.context).map(o=>o.version)),assetRevision:p.assetRevision,planVersion:p.plan.version,taskId:tid,created:now()};p.outputs.push(output);p.currentOutput=output.id;p.stage=`${output.stage}-review`;p.sampleApproval=null;this.finishTask(p,t,{outputId:output.id,path:output.path,version:output.version});return output;});
    } catch(e) {await this.store.transaction(s=>{const t=s.tasks.find(t=>t.id===tid);if(t?.status==='rendering'){t.status='failed';t.error=e.message;const p=findProject(s,pid);p.stage='failed';for(const oid of t.opinionIds)p.opinions.find(o=>o.id===oid).status='failed';}});throw e;}
  }
  async recover(tid) {
      return this.store.transaction(s=>{const t=s.tasks.find(t=>t.id===tid);check(t&&['accepted','running','rendering'].includes(t.status),'任务无需恢复');t.status='failed';t.error='用户或 Agent 确认旧执行进程已停止，恢复为可重试状态';const p=findProject(s,t.projectId);p.stage='failed';for(const oid of t.opinionIds){const o=p.opinions.find(o=>o.id===oid);if(o)o.status='failed';}return t;});
  }
  async verify(pid) {const p=await this.project(pid),o=p.outputs.find(o=>o.id===p.currentOutput);check(o?.stage==='full','还没有当前完整版');const info=await probe(o.path,{decode:true});check(Math.abs(info.duration-p.plan.duration)<.15&&(p.demo?!info.audio:info.audio)&&info.video,'完整版时长或音画流不完整');const result={...info,checked:now(),note:'技术解码通过；仍需人工检查完整字幕、事实、画面和音画同步。'};await atomic(this.folder(pid,'renders',o.id,'verification.json'),result);return result;}
}
