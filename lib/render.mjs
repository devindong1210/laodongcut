import fs from 'node:fs/promises';
import path from 'node:path';
import {check} from './store.mjs';
import {run, probe, hashFile} from './media.mjs';
import {motionScript} from './motion.mjs';

const num=n=>Math.round(n*1000)/1000;
const color=hex=>hex.slice(1).match(/../g).reverse().join('').toUpperCase();
const safeText=s=>String(s).replace(/\\/g,'＼').replace(/{/g,'｛').replace(/}/g,'｝').replace(/[\r\n]+/g,' ');
function wrap(text,maxWidth,size) {
  const lines=[''];let width=0;
  for(const ch of safeText(text)) {const w=size*(/^[\u0020-\u007e]$/.test(ch)?.56:1);if(width+w>maxWidth&&lines.at(-1)){lines.push('');width=0;}lines[lines.length-1]+=ch;width+=w;}
  return lines;
}
const stamp=s=>{const c=Math.round(s*100),h=Math.floor(c/360000),m=Math.floor(c/6000)%60,sec=Math.floor(c/100)%60;return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(c%100).padStart(2,'0')}`;};
function pixels(box,r){return box.map((v,i)=>Math.round(v*(i%2?r.height:r.width)));}
function assScript(p,duration) {
  const r=p.template.rules, lines=[], elements=[];
  function event(start,end,layer,content) {if(end>start)lines.push(`Dialogue: ${layer},${stamp(start)},${stamp(end)},Default,,0,0,0,,${content}`);}
  function rect(start,end,b,fill,layer=0){const [x,y,w,h]=b;event(start,end,layer,`{\\an7\\pos(${x},${y})\\p1\\bord0\\shad0\\c&H${color(fill)}&}m 0 0 l ${w} 0 l ${w} ${h} l 0 ${h} l 0 0{\\p0}`);}
  function text(start,end,textValue,b,size,{fill=r.palette.ink,layer=3,bold=false,center=false,fade=true}={}) {
    const [x,y,w,h]=b, wrapped=wrap(textValue,w-24,size);check(wrapped.length*size*1.35<=h,`「${String(textValue).slice(0,30)}」在模板区域中放不下；请拆分画面或缩短画面提炼文字（不得擅改口播）。`,400);
    event(start,end,layer,`{\\an${center?5:7}\\pos(${center?x+w/2:x+12},${center?y+h/2:y+8})\\fs${size}\\b${bold?1:0}\\c&H${color(fill)}&\\bord0\\shad0\\q2${fade?`\\fad(${Math.min(r.motion.enterMs,Math.round((end-start)*300))},0)`:''}}${wrapped.join('\\N')}`);
  }
  function element(scene,kind,name,box,start=scene.start,end=scene.end){elements.push({id:`${scene.id}/${kind}`,kind,name,description:r.production[kind]||'代码画面',production:kind==='media'?'素材 + 代码排版／动效':kind==='person'?'需要自定义人物素材':'代码可以直接做好',box,start:num(start),end:num(Math.min(end,duration)),sceneId:scene.id});}
  for(const scene of p.plan.scenes.filter(s=>s.start<duration)) {
    const start=scene.start,end=Math.min(scene.end,duration),title=pixels(r.layout.title,r),cards=pixels(r.layout.cards,r),caption=pixels(r.layout.caption,r);
    const titleSize=scene.overrides?.titleSize||r.fontSizes.title, cardSize=scene.overrides?.cardSize||r.fontSizes.cards;
    text(start,end,scene.title,title,titleSize,{bold:true,center:true});element(scene,'title','标题',r.layout.title,start,end);
    element(scene,'background','背景',[0,0,1,1],start,end);
    if(scene.type==='media') cards[3]=Math.max(60,pixels(r.layout.media,r)[1]-cards[1]-24);
    const gap=18,count=scene.items.length,boxH=count?(cards[3]-gap*(count-1))/count:0;
    for(let i=0;i<count;i++) {
      const at=Math.min(start+i*r.motion.staggerMs/1000,end-.05),b=[cards[0],Math.round(cards[1]+i*(boxH+gap)),cards[2],Math.round(boxH)];
      rect(at,end,b,r.palette.card,1);
      if(scene.type==='bar') {rect(at,end,[b[0],b[1]+b[3]-8,Math.round(b[2]*scene.values[i]),8],r.palette.accent,2);}
      text(at,end,`${scene.type==='steps'?`${i+1}. `:''}${scene.items[i]}`,b,cardSize,{center:scene.type!=='bar'});
    }
    if(count)element(scene,'cards',scene.type==='bar'?'条形图':'知识卡片',r.layout.cards,start,end);
    if(scene.type==='media')element(scene,'media','配图 / B-roll',r.layout.media,start,end);
    if(p.assets.find(a=>a.id===p.speechId).kind==='video')element(scene,'person','人物小窗',r.layout.person,start,end);
    element(scene,'caption','字幕',r.layout.caption,start,end);
    for(const cue of p.rough.timeline.filter(c=>c.end>start&&c.start<end)) {
      const cs=Math.max(start,cue.start),ce=Math.min(end,cue.end),size=scene.overrides?.captionSize||r.fontSizes.caption;
      rect(cs,ce,caption,r.palette.card,4);text(cs,ce,cue.text,caption,size,{layer:5,center:true,fade:false});
    }
  }
  return {elements,ass:`[Script Info]\nScriptType: v4.00+\nPlayResX: ${r.width}\nPlayResY: ${r.height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${r.font},${r.fontSizes.cards},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join('\n')}\n`};
}
async function cutSpeech(p,folder) {
  const a=p.assets.find(a=>a.id===p.speechId),video=a.kind==='video',filters=[],labels=[];
  p.rough.keep.forEach((k,i)=>{
    filters.push(`[0:a:0]atrim=start=${num(k.start)}:end=${num(k.end)},asetpts=PTS-STARTPTS,aresample=48000[a${i}]`);
    if(video)filters.push(`[0:v:0]trim=start=${num(k.start)}:end=${num(k.end)},setpts=PTS-STARTPTS,fps=${p.template.rules.fps},setsar=1[v${i}]`);
    labels.push(video?`[v${i}][a${i}]`:`[a${i}]`);
  });
  filters.push(`${labels.join('')}concat=n=${labels.length}:v=${video?1:0}:a=1${video?'[v][a]':'[a]'}`);
  await fs.writeFile(path.join(folder,'cut.ffscript'),filters.join(';\n'));
  const dest=path.join(folder,video?'edited.mp4':'edited.wav');
  const args=['-v','error','-y','-i',a.path,'-filter_complex_script','cut.ffscript'];
  if(video)args.push('-map','[v]','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p');
  args.push('-map','[a]','-c:a',video?'aac':'pcm_s16le',dest);
  await run('ffmpeg',args,{cwd:folder});return dest;
}
export async function renderVideo(p,stage,folder) {
  await fs.mkdir(folder,{recursive:true});
  const duration=stage==='sample'?Math.min(10,p.plan.duration):p.plan.duration,r=p.template.rules;
  const {ass,elements}=r.renderer==='motion-v2'?motionScript(p,duration):assScript(p,duration);
  const isMotion=r.renderer==='motion-v2';
  await fs.writeFile(path.join(folder,'captions.ass'),isMotion?ass.split('\n').filter(l=>!l.startsWith('Dialogue: ')||Number(l.split(': ')[1].split(',')[0])>=6).join('\n'):ass,'utf8');
  if(isMotion)await fs.writeFile(path.join(folder,'scene.ass'),ass.split('\n').filter(l=>!l.startsWith('Dialogue: ')||Number(l.split(': ')[1].split(',')[0])<6).join('\n'),'utf8');
  const edited=await cutSpeech(p,folder),speech=p.assets.find(a=>a.id===p.speechId);
  const args=['-v','error','-y','-f','lavfi','-i',`color=c=${r.palette.background}:s=${r.width}x${r.height}:r=${r.fps}:d=${duration}`,'-i',edited];
  const filters=[];let prev='0:v',n=2,layer=0;const media=[];
  if(isMotion){filters.push('[0:v]ass=filename=scene.ass[scene]');prev='scene';}
  for(const scene of p.plan.scenes.filter(s=>s.start<duration&&s.type==='media')) {
    const asset=p.assets.find(a=>a.id===scene.assetId),info=await probe(asset.path,{decode:true});
    check(info.video,'配图或B-roll不能解码为图像',400);
    if(asset.kind==='image')args.push('-loop','1','-i',asset.path);else args.push('-stream_loop','-1','-i',asset.path);
    const [x,y,w,h]=pixels(r.layout.media,r).map(v=>Math.floor(v/2)*2),label=`media${n}`,out=`layer${++layer}`;
    filters.push(`[${n}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${r.fps},setpts=PTS-STARTPTS+${scene.start}/TB[${label}]`);
    filters.push(`[${prev}][${label}]overlay=x=${x}:y=${y}:enable='gte(t,${scene.start})*lt(t,${Math.min(scene.end,duration)})':eof_action=pass[${out}]`);
    prev=out;n++;media.push({assetId:asset.id,sha256:info.sha256});
  }
  if(speech.kind==='video') {
    const [x,y,w,h]=pixels(r.layout.person,r).map(v=>Math.floor(v/2)*2),out=`layer${++layer}`;
    const mask=isMotion?`,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(abs(X-W/2),W/2-22)*gt(abs(Y-H/2),H/2-22),if(lte(pow(abs(X-W/2)-(W/2-22),2)+pow(abs(Y-H/2)-(H/2-22),2),484),255,0),255)'`:'';
    filters.push(`[1:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}${isMotion?`:y=ih*0.25-${h}*0.25`:''},setsar=1${mask}[person]`);
    filters.push(`[${prev}][person]overlay=x=${x}:y=${y}:eof_action=pass[${out}]`);prev=out;
  }
  filters.push(`[${prev}]ass=filename=captions.ass,format=yuv420p[out]`);
  await fs.writeFile(path.join(folder,'render.ffscript'),filters.join(';\n'));
  const dest=path.join(folder,'video.mp4');
  args.push('-filter_complex_script','render.ffscript','-map','[out]','-map','1:a:0','-t',num(duration),'-r',r.fps,'-c:v','libx264','-preset','fast','-crf','20','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',dest);
  await run('ffmpeg',args,{cwd:folder,timeout:Math.max(600000,duration*30000)});
  const info=await probe(dest,{decode:true});
  check(info.video&&info.audio&&Math.abs(info.duration-duration)<.15,'渲染结果缺少音画流或时长不符');
  const poster=path.join(folder,'poster.jpg');await run('ffmpeg',['-v','error','-y','-ss',Math.min(.8,duration/2),'-i',dest,'-frames:v','1',poster]);
  return {path:dest,poster,duration:info.duration,contentDuration:duration,width:r.width,height:r.height,elements,sha256:await hashFile(dest),media,technicalCheck:{decoded:true,audio:true,video:true},reviewNote:'已通过完整解码；请人工审核字幕、素材含义和完整音画同步。'};
}
