import {check} from './store.mjs';

const finite = n => typeof n === 'number' && Number.isFinite(n);
export function validateRules(r) {
  check(r && typeof r === 'object', '缺少模板规则',400);
  check(Number.isInteger(r.width) && r.width>=360 && r.width<=1920 && r.width%2===0 && Number.isInteger(r.height) && r.height>=360 && r.height<=1920 && r.height%2===0, '画面宽高须为360—1920间的偶数',400);
  check([24,25,30].includes(r.fps),'首版支持24、25、30帧',400);
  for (const key of ['background','ink','accent','card','muted']) check(/^#[\da-f]{6}$/i.test(r.palette?.[key]),`配色缺少 ${key}`,400);
  check(typeof r.font==='string' && r.font.length>0 && r.font.length<100 && !/[\r\n,]/.test(r.font),'字体名称无效',400);
  for (const key of ['title','cards','caption']) check(finite(r.fontSizes?.[key]) && r.fontSizes[key]>=16 && r.fontSizes[key]<=100, `字号 ${key} 无效`,400);
  for (const key of ['title','cards','media','person','caption']) {
    const b=r.layout?.[key]; check(Array.isArray(b)&&b.length===4&&b.every(finite)&&b[0]>=0&&b[1]>=0&&b[2]>0&&b[3]>0&&b[0]+b[2]<=1.001&&b[1]+b[3]<=1.001,`区域 ${key} 超出画面`,400);
  }
  check(Array.isArray(r.sceneTypes)&&r.sceneTypes.length>0&&r.sceneTypes.every(x=>['list','steps','focus','media','bar','motion'].includes(x)), '模板画面类型超出渲染能力',400);
  check(finite(r.motion?.enterMs)&&r.motion.enterMs>=0&&r.motion.enterMs<=2000&&finite(r.motion?.staggerMs)&&r.motion.staggerMs>=0&&r.motion.staggerMs<=2000,'动效时间无效',400);
  check(r.production && typeof r.scope==='string','缺少生产方式或适用范围',400);
  return r;
}
export function validateRough(doc,duration) {
  check(['user','asr','agent-listening'].includes(doc.transcriptSource),'必须注明真实转写来源 user / asr / agent-listening',400);
  check(Array.isArray(doc.keep)&&doc.keep.length>0,'缺少保留区间',400);
  let previous=0;
  for (const k of doc.keep) { check(finite(k.start)&&finite(k.end)&&k.start>=previous-.001&&k.end>k.start&&k.end<=duration+.03,'保留区间重叠、越界或不是正数',400); previous=k.end; }
  check(Array.isArray(doc.cues)&&doc.cues.length>0,'需要带原素材时间的真实讲解转写',400);
  previous=0;
  for (const c of doc.cues) {
    check(finite(c.start)&&finite(c.end)&&c.start>=previous-.001&&c.end>c.start&&c.end<=duration+.03&&typeof c.text==='string'&&c.text.trim(),'字幕时间重叠、越界或文本为空',400); previous=c.end;
    const hits=doc.keep.filter(k=>c.end>k.start+.001&&c.start<k.end-.001);
    check(!hits.length||(hits.length===1&&c.start>=hits[0].start-.001&&c.end<=hits[0].end+.001),'剪切点穿过字幕，请先根据回听重新拆分这句字幕',400);
  }
  let offset=0; const timeline=[];
  for (const k of doc.keep) {
    for (const c of doc.cues.filter(c=>c.start>=k.start-.001&&c.end<=k.end+.001)) timeline.push({...c,start:offset+c.start-k.start,end:offset+c.end-k.start});
    offset+=k.end-k.start;
  }
  check(timeline.length>0,'保留区间没有讲解内容',400);
  return {...doc,duration:offset,timeline};
}
export function validatePlan(doc, project) {
  const duration=project.rough.duration, rules=project.template.rules;
  if(rules.themeRequired||doc.theme){
    const t=doc.theme;check(t&&typeof t.reason==='string'&&t.reason.trim()&&typeof t.elementStyle==='string'&&t.elementStyle.trim(),'请依据内容设计主题，并说明背景与元素风格',400);
    for(const c of [t.background?.top,t.background?.bottom,t.board,t.divider,t.presenterBorder,t.title,t.caption,t.captionOutline])check(typeof c==='string'&&/^#[\da-f]{6}$/i.test(c),'主题配色必须完整且为六位十六进制颜色',400);
    check(['none','grid','dots'].includes(t.background.pattern),'背景纹理应选择none/grid/dots；其他材质需扩展渲染器',400);
    if(t.background.pattern!=='none')check(/^#[\da-f]{6}$/i.test(t.background.patternColor||''),'纹理需要独立配色',400);
  }
  if(rules.renderer==='motion-v2'){
    check(rules.width===1080&&rules.height===1920,'干货讲解竖屏模板须原生1080×1920',400);
    check(Array.isArray(doc.titleLines)&&doc.titleLines.length===2&&doc.titleLines.every(s=>typeof s==='string'&&s.length<=14),'竖屏模板标题需要两行、每行不超过14字',400);
    check(Array.isArray(doc.captions)&&doc.captions.length>0,'需要实测短语字幕',400);
    const norm=s=>s.replace(/[\s，。！？、；：,.!?;:]/g,'');
    check(norm(doc.captions.map(c=>c.text).join(''))===norm(project.rough.timeline.map(c=>c.text).join('')),'分句字幕必须保留已确认全文',400);
    let prev=0;
    for(const c of doc.captions){check(finite(c.start)&&finite(c.end)&&c.start>=prev-.001&&c.end>c.start&&c.end<=duration+.03&&typeof c.text==='string'&&!/[\r\n]/.test(c.text)&&[...c.text].reduce((v,ch)=>v+(/[\x00-\x7f]/.test(ch)?.56:1),0)*52<=856,'字幕时间或单行安全区不合格；按真实短语拆分',400);prev=c.end;}
  }
  check(Array.isArray(doc.scenes)&&doc.scenes.length>0,'缺少按自己口播规划的画面',400);
  const ids=new Set(); let previous=0;
  for (const s of doc.scenes) {
    check(typeof s.id==='string'&&/^[a-z\d_-]+$/i.test(s.id)&&!ids.has(s.id),'片段ID重复或无效',400); ids.add(s.id);
    check(finite(s.start)&&finite(s.end)&&Math.abs(s.start-previous)<.03&&s.end>s.start&&s.end<=duration+.03,'画面时间必须连续，且在剪后时长内',400); previous=s.end;
    check(rules.sceneTypes.includes(s.type),'画面类型不服从当前模板规则',400);
    check(typeof s.title==='string'&&s.title.trim()&&s.title.length<=160,'缺少标题或标题过长',400);
    check(Array.isArray(s.items)&&s.items.length<=5&&s.items.every(x=>typeof x==='string'&&x.length<=140),'卡片最多5项，每项最多140字；长内容请重新分段',400);
    if(rules.renderer==='motion-v2')check(s.type==='motion','动效模板不能退回默认文字卡片；请设计矢量场景',400);
    if(s.type==='motion'){
      check(rules.renderer==='motion-v2'&&s.intent&&s.action&&s.result&&Array.isArray(s.nodes)&&s.nodes.length>0&&s.nodes.length<=150,'动效场景需要意思、动作、结果及可渲染对象',400);
      const nodeIds=new Set();
      for(const n of s.nodes){
        check(typeof n.id==='string'&&!nodeIds.has(n.id),'场景对象ID缺失或重复',400);nodeIds.add(n.id);
        check(['rect','ellipse','path','text'].includes(n.kind)&&finite(n.x)&&finite(n.y),'矢量对象类别或坐标无效',400);
        for(const key of ['fill','stroke'])if(n[key])check(/^#[\da-f]{6}$/i.test(n[key]),'对象颜色无效',400);
        check(!n.layer||(Number.isInteger(n.layer)&&n.layer>=1&&n.layer<=5),'内容对象层级须为1—5',400);
        if(['rect','ellipse'].includes(n.kind))check(finite(n.w)&&finite(n.h)&&n.w>0&&n.h>0,'图形尺寸无效',400);
        if(n.kind==='path')check(typeof n.path==='string'&&n.path.length<12000&&/^[mnlbspc\d\s.,-]+$/.test(n.path),'路径仅支持ASS矢量命令及数字',400);
        if(n.kind==='text')check(typeof n.text==='string'&&n.text.length<=100&&finite(n.size)&&n.size>=25&&n.size<=100,'场景文字应为25—100px可读短标签',400);
        let at=-1;for(const k of n.keyframes||[]){check(finite(k.at)&&k.at>=0&&k.at>at&&k.at<=s.end-s.start+.03,'关键帧须按片段内秒数递增',400);at=k.at;for(const key of ['x','y','scale','rotate','opacity'])if(k[key]!==undefined)check(finite(k[key]),'关键帧属性无效',400);if(k.opacity!==undefined)check(k.opacity>=0&&k.opacity<=1,'透明度越界',400);}
      }
    }
    if(s.type==='bar') check(Array.isArray(s.values)&&s.values.length===s.items.length&&s.values.every(x=>finite(x)&&x>=0&&x<=1),'条形图需要0—1的真实数值，不能编造数据',400);
    if(s.type==='media') {
      const asset=project.assets.find(a=>a.id===s.assetId&&a.role==='custom');
      check(asset&&['image','video'].includes(asset.kind),'配图画面必须引用已保存的图片或视频素材',400);
      check(s.items.length<=1,'配图画面最多1项短说明，避免与素材重叠',400);
    }
    if(s.overrides) {
      check(Object.keys(s.overrides).every(k=>['titleSize','cardSize','captionSize'].includes(k)),'首版只支持片段字号覆盖，布局修改应更新模板规则或扩展渲染器',400);
      for (const v of Object.values(s.overrides)) check(finite(v)&&v>=16&&v<=100,'覆盖字号无效',400);
    }
  }
  check(Math.abs(previous-duration)<.03,'画面规划必须覆盖全部真实讲解时长；样片渲染时才截取前10秒',400);
  return {...doc,duration};
}
