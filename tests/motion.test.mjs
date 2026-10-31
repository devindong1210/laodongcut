import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Engine} from '../lib/engine.mjs';
import {validatePlan} from '../lib/schema.mjs';
import {nodeState,motionScript} from '../lib/motion.mjs';
const tpl=JSON.parse(await fs.readFile(new URL('../templates/knowledge.json',import.meta.url)));
const rules=tpl.versions.find(v=>v.version===2).rules;
const project={template:{rules},rough:{duration:1,timeline:[{start:0,end:1,text:'测试字幕。'}]}};
const plan={titleLines:['测试标题','内容驱动画面'],captions:[{start:0,end:1,text:'测试字幕。'}],scenes:[{id:'scene',start:0,end:1,type:'motion',title:'场景',items:[],intent:'解释动作',action:'对象移动',result:'抵达目标',nodes:[{id:'box',kind:'rect',x:100,y:500,w:100,h:100,fill:'#FFFFFF',keyframes:[{at:0,x:100},{at:1,x:600}]}]}]};
test('动效规划保留确认全文、拒绝超长字幕和纯文字回退',()=>{assert.equal(validatePlan(structuredClone(plan),project).duration,1);const altered=structuredClone(plan);altered.captions[0].text='擅改';assert.throws(()=>validatePlan(altered,project),/保留已确认全文/);const fallback=structuredClone(plan);fallback.scenes[0].type='focus';assert.throws(()=>validatePlan(fallback,project),/类型|退回/);const long=structuredClone(plan);long.captions[0].text='很'.repeat(30);assert.throws(()=>validatePlan(long,{...project,rough:{...project.rough,timeline:long.captions}}),/单行安全区/);});
test('运动具有中间状态、底图和字幕层级正确、元素可定位',()=>{const n=plan.scenes[0].nodes[0];assert.equal(nodeState(n,.5).x,350);const out=motionScript({...project,plan},1);assert.match(out.ass,/Dialogue: 0,/);assert.match(out.ass,/Dialogue: 10,/);assert.ok(out.ass.includes('pos(350.00,500.00)'));assert.ok(out.elements.find(e=>e.id==='scene/box').box[2]<.6);});
test('新项目默认当前模板，旧项目快照保留，显式升级保留历史并撤销样片批准',async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'motion-template-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const e=await new Engine(dir).init();const old=await e.create({templateId:tpl.id,templateVersion:1});const fresh=await e.create({templateId:tpl.id});assert.equal(fresh.template.version,tpl.current);await e.init();assert.equal((await e.project(old.id)).template.version,1);await e.upgradeBuiltin(old.id,'测试用户明确升级');const p=await e.project(old.id);assert.equal(p.template.version,tpl.current);assert.equal(p.history[0].template.version,1);assert.equal(p.sampleApproval,null);});

test('通用模板无品牌页脚、两行标题实际居中、主题是必填设计',()=>{const rules3=tpl.versions.find(v=>v.version===3).rules;const p3={...project,template:{rules:rules3}};assert.throws(()=>validatePlan(plan,p3),/主题/);const themed=structuredClone(plan);themed.theme={reason:'教育纸张主题',elementStyle:'自然纸片插画',background:{top:'#EEEADD',bottom:'#CFDFD0',pattern:'grid',patternColor:'#99AA88'},board:'#304030',divider:'#998877',presenterBorder:'#887766',title:'#223322',caption:'#FFFFEE',captionOutline:'#112211'};validatePlan(themed,p3);const out=motionScript({...p3,plan:themed},1).ass;assert.ok(!out.includes('老董'));for(const y of [226,306])assert.ok(out.includes('\\an8\\pos(540.00,'+y+'.00)'));assert.ok(out.includes('776655')===false);assert.ok(out.includes('778899'));});
