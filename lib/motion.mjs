// Deterministic vector scene graph. Positions are native canvas pixels;
// keyframes use scene-local seconds, never wall-clock time.
const esc=s=>String(s).replace(/\\/g,'＼').replace(/[{}]/g,'').replace(/\n/g,'\\N');
const col=s=>s.slice(1).match(/../g).reverse().join('').toUpperCase();
const stamp=s=>{const c=Math.round(s*100);return `${Math.floor(c/360000)}:${String(Math.floor(c/6000)%60).padStart(2,'0')}:${String(Math.floor(c/100)%60).padStart(2,'0')}.${String(c%100).padStart(2,'0')}`;};
export function nodeState(n,t) {
  const base={x:0,y:0,scale:1,rotate:0,opacity:1,...n}, ks=n.keyframes||[];
  if(!ks.length)return base;
  let a=ks[0],b=a;
  for(const k of ks){if(k.at<=t)a=k;if(k.at>t){b=k;break;}b=a;}
  let f=b.at===a.at?0:Math.max(0,Math.min(1,(t-a.at)/(b.at-a.at)));
  if(b.ease!=='linear')f=f*f*(3-2*f);
  for(const key of ['x','y','scale','rotate','opacity'])base[key]=(a[key]??base[key])+((b[key]??a[key]??base[key])-(a[key]??base[key]))*f;
  return base;
}
export function roundRect(w,h,r=0){return `m ${r} 0 l ${w-r} 0 b ${w} 0 ${w} 0 ${w} ${r} l ${w} ${h-r} b ${w} ${h} ${w} ${h} ${w-r} ${h} l ${r} ${h} b 0 ${h} 0 ${h} 0 ${h-r} l 0 ${r} b 0 0 0 0 ${r} 0`;}
export function ellipse(w,h){const x=w/2,y=h/2,k=.5522848;return `m ${w} ${y} b ${w} ${y+y*k} ${x+x*k} ${h} ${x} ${h} b ${x-x*k} ${h} 0 ${y+y*k} 0 ${y} b 0 ${y-y*k} ${x-x*k} 0 ${x} 0 b ${x+x*k} 0 ${w} ${y-y*k} ${w} ${y}`;}
export function motionScript(p,duration){
  const r=p.template.rules,lines=[],elements=[];
  // Legacy snapshots retain their palette; new plans supply a content-led theme.
  const theme=p.plan.theme||{background:{top:r.palette.background,bottom:r.palette.background,pattern:'none'},board:r.palette.card,divider:r.palette.accent,presenterBorder:r.palette.accent,title:r.palette.ink,caption:r.palette.ink,captionOutline:r.palette.background};
  const event=(start,end,layer,body)=>{if(end>start)lines.push(`Dialogue: ${layer},${stamp(start)},${stamp(end)},Default,,0,0,0,,${body}`);};
  function draw(n,start,end,t=0){
    const v=nodeState(n,t);if(v.opacity<=0)return;
    const alpha=Math.round((1-v.opacity)*255).toString(16).padStart(2,'0');
    const tags=`\\an${n.align||7}\\pos(${v.x.toFixed(2)},${v.y.toFixed(2)})\\fscx${100*v.scale}\\fscy${100*v.scale}\\frz${v.rotate}\\alpha&H${alpha}&\\c&H${col(n.fill||r.palette.ink)}&\\bord${n.strokeWidth||0}\\3c&H${col(n.stroke||n.fill||r.palette.ink)}&\\shad0`;
    const body=n.kind==='text'?`{${tags}\\fs${n.size||40}\\b${n.bold?1:0}\\q2}${esc(n.text)}`:`{${tags}${n.kind==='path'&&n.strokeWidth?'\\1a&HFF&':''}\\p1}${n.kind==='ellipse'?ellipse(n.w,n.h):n.kind==='rect'?roundRect(n.w,n.h,n.radius||0):n.path}{\\p0}`;
    event(start,end,n.layer??3,body);
  }
  const rgb=s=>s.slice(1).match(/../g).map(v=>parseInt(v,16)),top=rgb(theme.background.top),bottom=rgb(theme.background.bottom);
  for(let y=0;y<1920;y+=8){const f=y/1912,c=top.map((v,i)=>Math.round(v+(bottom[i]-v)*f).toString(16).padStart(2,'0')).join('');draw({kind:'rect',x:0,y,w:1080,h:8,fill:'#'+c,layer:0},0,duration);}
  if(theme.background.pattern==='grid'){
    for(let y=36;y<1920;y+=72)draw({kind:'rect',x:0,y,w:1080,h:1,fill:theme.background.patternColor,opacity:.12,layer:0},0,duration);
    for(let x=36;x<1080;x+=72)draw({kind:'rect',x,y:0,w:1,h:1920,fill:theme.background.patternColor,opacity:.12,layer:0},0,duration);
  }
  if(theme.background.pattern==='dots')for(let y=36;y<1920;y+=72)for(let x=36;x<1080;x+=72)draw({kind:'ellipse',x,y,w:3,h:3,fill:theme.background.patternColor,opacity:.18,layer:0},0,duration);
  draw({kind:'rect',x:52,y:420,w:976,h:940,radius:26,fill:theme.board,layer:1},0,duration);
  for(const y of [420,1360])draw({kind:'rect',x:68,y,w:944,h:2,fill:theme.divider,layer:2},0,duration);
  const title=p.plan.titleLines;
  title.forEach((s,i)=>draw({kind:'text',x:540,y:226+i*80,align:8,text:s.trim(),size:66,bold:true,fill:theme.title},0,duration));
  // Border outside the source media; ASS is composited above the presenter.
  const [px,py,pw,ph]=r.layout.person.map((v,i)=>v*(i%2?1920:1080));
  if(p.assets?.find(a=>a.id===p.speechId)?.kind==='video')event(0,duration,6,`{\\an7\\pos(${px-3},${py-3})\\p1\\bord3\\shad0\\1a&HFF&\\3c&H${col(theme.presenterBorder)}&}${roundRect(pw+6,ph+6,22)}{\\p0}`);
  for(const s of p.plan.scenes.filter(s=>s.start<duration)){
    const end=Math.min(s.end,duration);
    for(const n of s.nodes){
      const a=s.start+(n.start||0),b=Math.min(end,s.start+(n.end??s.end-s.start));
      if(n.keyframes?.length){for(let i=Math.round(a*r.fps);i<Math.round(b*r.fps);i++)draw(n,i/r.fps,Math.min((i+1)/r.fps,b),i/r.fps-s.start);}
      else draw(n,a,b);
      const coords=n.kind==='path'?(n.path.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number):[];
      const xs=coords.filter((_,i)=>i%2===0),ys=coords.filter((_,i)=>i%2===1);
      const w=n.w||(n.kind==='text'?n.text.length*n.size:Math.max(1,...xs)-Math.min(0,...xs)),h=n.h||(n.kind==='text'?n.size*1.4:Math.max(1,...ys)-Math.min(0,...ys));
      const states=[nodeState(n,0),...(n.keyframes||[]).map(k=>nodeState(n,k.at))];
      const x=Math.max(0,Math.min(...states.map(v=>v.x+Math.min(0,...xs)*v.scale))-8),y=Math.max(0,Math.min(...states.map(v=>v.y+Math.min(0,...ys)*v.scale))-8);
      const right=Math.min(1080,Math.max(...states.map(v=>v.x+w*v.scale))+8),bottom=Math.min(1920,Math.max(...states.map(v=>v.y+h*v.scale))+8);
      elements.push({id:`${s.id}/${n.id}`,sceneId:s.id,kind:n.kind,name:n.name||n.id,description:n.meaning||s.intent,production:'代码矢量图形与语义动作',box:n.box||[x/1080,y/1920,Math.max(1,right-x)/1080,Math.max(1,bottom-y)/1920],start:a,end:b});
    }
    for(const kind of ['title',...(p.assets?.find(a=>a.id===p.speechId)?.kind==='video'?['person']:[]),'caption'])elements.push({id:`${s.id}/${kind}`,sceneId:s.id,kind,name:{title:'固定主标题',person:'人物小窗',caption:'单行字幕'}[kind],description:r.production[kind],production:'代码合成',box:r.layout[kind],start:s.start,end});
  }
  for(const c of p.plan.captions){const end=Math.min(c.end,duration);if(c.start>=end)continue;event(c.start,end,10,`{\\an2\\pos(540,1320)\\fs52\\b1\\c&H${col(theme.caption)}&\\bord2.5\\3c&H${col(theme.captionOutline)}&\\shad0\\q2}${esc(c.text)}`);}
  return {elements,ass:`[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${r.font},40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join('\n')}\n`};
}
