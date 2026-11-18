const byId=id=>document.getElementById(id);
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

export function createTimeline({escape,seek,save,preview}) {
  const scroll=byId('timelineScroll');
  const status=byId('timelineStatus');
  const undo=byId('timelineUndo');
  const zoom=byId('timelineZoom');
  const previewButton=byId('timelinePreview');
  let model,drawnKey='',zoomed=false,drag,busy=false,message='',position=0,selection;

  const percent=time=>100*time/model.project.plan.duration;
  const blockStyle=(start,end)=>`left:${percent(start)}%;width:${percent(end-start)}%`;

  function draw() {
    if(!model)return;
    const {project,output,blocked}=model;
    const {plan,rough,assets}=project;
    const key=`${project.id}/${output.id}/${plan.version}/${zoomed}/${blocked}`;
    if(drawnKey!==key&&!drag){
      const active=document.activeElement?.dataset.scene;
      drawnKey=key;
      const captions=plan.captions??rough.timeline;
      const clips=plan.scenes.filter(scene=>scene.type==='media'||(scene.type==='motion'&&scene.assetId));
      const tick=Math.max(1,Math.ceil(plan.duration/(zoomed?plan.duration:12)));
      const ticks=[];
      for(let t=0;t<plan.duration;t+=tick)ticks.push(`<span style="left:${percent(t)}%">${t}s</span>`);
      scroll.innerHTML=`<div class="timeline-grid" style="width:${zoomed?Math.max(700,plan.duration*100+90):700}px">
        <div class="timeline-labels"><div>秒</div><div>口播</div><div>字幕</div><div>补充素材</div></div>
        <div class="timeline-body">
          <div class="timeline-ruler" title="点击定位播放">${ticks.join('')}</div>
          <div class="timeline-lane"><button class="timeline-block voice" data-start="0" style="${blockStyle(0,plan.duration)}">${escape(assets.find(a=>a.id===project.speechId)?.name||'口播')}</button></div>
          <div class="timeline-lane">${captions.map(c=>`<button class="timeline-block subtitle" data-start="${c.start}" style="${blockStyle(c.start,c.end)}" title="${escape(c.text)}">${escape(c.text)}</button>`).join('')}</div>
          <div class="timeline-lane">${clips.map(scene=>{
            const {start,end}=scene.mediaTiming??scene;
            const label=escape(assets.find(a=>a.id===scene.assetId)?.name||'补充素材');
            return `<button class="timeline-block media-clip" data-scene="${escape(scene.id)}" data-start="${start}" data-end="${end}" style="${blockStyle(start,end)}" aria-label="${label}，${start.toFixed(2)} 至 ${end.toFixed(2)} 秒" title="${label} · ${start.toFixed(2)}–${end.toFixed(2)} 秒">
              <span class="trim-edge" data-edge="start" aria-hidden="true"></span><span class="clip-label">${label}</span><span class="trim-edge" data-edge="end" aria-hidden="true"></span>
            </button>`;
          }).join('')||'<span class="timeline-empty">当前编排里没有补充素材</span>'}</div>
          <div class="timeline-playhead" aria-hidden="true"></div>
        </div>
      </div>`;
      if(active)Array.from(scroll.querySelectorAll('[data-scene]')).find(e=>e.dataset.scene===active)?.focus({preventScroll:true});
    }
    scroll.classList.toggle('editing-blocked',blocked||busy);
    undo.disabled=blocked||busy||!output.timelineEdit||output.timelineEdit.undone;
    previewButton.classList.toggle('hidden',!output.timelineEdit?.preview);
    status.textContent=busy?'正在生成新预览…':message||(blocked?'请先处理当前制作任务或修改意见。':'拖动素材调整出现时间，拖两端调整时长。');
    zoom.textContent=zoomed?'适应全片':'放大';
    zoom.setAttribute('aria-pressed',String(zoomed));
    showPosition(position,selection);
  }

  function showPosition(time,elementId) {
    position=time;
    selection=elementId;
    const playhead=scroll.querySelector('.timeline-playhead');
    if(!model||!playhead)return;
    playhead.style.left=`${percent(time)}%`;
    for(const block of scroll.querySelectorAll('[data-scene]')){
      block.classList.toggle('selected',elementId===`${block.dataset.scene}/media`);
    }
  }

  async function commit(change,base=model) {
    if(!base||base.blocked||busy)return;
    busy=true;
    message='';
    draw();
    try {
      await save(base.project.id,{outputId:base.output.id,planVersion:base.project.plan.version,...change});
      message='时间调整已保存';
    } catch(error) {
      message=error.message;
      drawnKey='';
    } finally {
      busy=false;
      draw();
    }
  }

  undo.onclick=()=>commit({undo:true});
  previewButton.onclick=()=>preview(model.output.timelineEdit.preview);
  zoom.onclick=()=>{zoomed=!zoomed;draw();};

  scroll.addEventListener('click',event=>{
    if(!model||busy)return;
    const block=event.target.closest('[data-start]');
    const lane=event.target.closest('.timeline-ruler,.timeline-lane');
    if(block){
      seek(Number(block.dataset.start),block.dataset.scene?`${block.dataset.scene}/media`:null);
    } else if(lane) {
      const box=lane.getBoundingClientRect();
      seek(clamp((event.clientX-box.left)/box.width,0,1)*model.project.plan.duration);
    }
  });

  scroll.addEventListener('pointerdown',event=>{
    const block=event.target.closest('[data-scene]');
    if(!block||model.blocked||busy||event.button!==0)return;
    const {scene,start,end}=block.dataset;
    drag={block,pointer:event.pointerId,x:event.clientX,width:block.parentElement.clientWidth,scene,start:Number(start),end:Number(end),edge:event.target.dataset.edge,base:model};
    scroll.setPointerCapture(event.pointerId);
    block.focus({preventScroll:true});
  });

  scroll.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.pointer)return;
    const {plan,template}=drag.base.project;
    const fps=template.rules.fps,frame=1/fps;
    const difference=event.clientX-drag.x;
    if(!drag.next&&Math.abs(difference)<3)return;
    const delta=Math.round(difference/drag.width*plan.duration*fps)/fps;
    let {start,end}=drag;
    if(drag.edge==='start')start=clamp(start+delta,0,end-frame);
    else if(drag.edge==='end')end=clamp(end+delta,start+frame,plan.duration);
    else {
      const shift=clamp(delta,-start,plan.duration-end);
      start+=shift;
      end+=shift;
    }
    drag.next={sceneId:drag.scene,start,end};
    drag.block.style.cssText=blockStyle(start,end);
  });

  function endDrag(event,cancel) {
    if(!drag||event.pointerId!==drag.pointer)return;
    const {block,start,end,next,base}=drag;
    drag=null;
    block.style.cssText=blockStyle(start,end);
    if(cancel||!next||next.start===start&&next.end===end){
      if(!cancel&&!next)seek(start,`${block.dataset.scene}/media`);
      draw();
      return;
    }
    commit(next,base);
  }
  scroll.addEventListener('pointerup',event=>endDrag(event,false));
  scroll.addEventListener('pointercancel',event=>endDrag(event,true));

  scroll.addEventListener('keydown',event=>{
    const block=event.target.closest('[data-scene]');
    if(!block||!model||!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();
    const {start,end,scene}=block.dataset;
    const delta=(event.key==='ArrowLeft'?-1:1)/model.project.template.rules.fps;
    const shift=clamp(delta,-Number(start),model.project.plan.duration-Number(end));
    if(shift)commit({sceneId:scene,start:Number(start)+shift,end:Number(end)+shift});
  });

  return {
    update(next) {
      if(model?.project.id!==next.project.id){drawnKey='';zoomed=false;message='';}
      model=next;
      draw();
    },
    showPosition
  };
}
