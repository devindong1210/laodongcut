#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {Engine,bundle} from '../lib/engine.mjs';
import {run,binary} from '../lib/media.mjs';
import {serve} from '../lib/server.mjs';
import {check} from '../lib/store.mjs';
import {importDemo} from '../lib/demo.mjs';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++)if(args[i].startsWith('--')){const key=args[i].slice(2);options[key]=args[i+1]&&!args[i+1].startsWith('--')?args.splice(i+1,1)[0]:true;args.splice(i--,1);}
const [command,a,b]=args;
const data=path.resolve(options.data||process.env.LAODONGCUT_DATA||path.join(bundle,'data'));
const print=value=>console.log(JSON.stringify(value,null,2));
const read=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
try {
  if(!command||command==='help'){
    console.log(`老董智能剪辑 v0.1\nnode scripts/cli.mjs <命令> [--data 数据目录]\n\nserve [--port 4319]                启动本地页面\ndoctor                            检查本机依赖和异常任务\ncreate [--template knowledge-sharing] [--name 名称]\nimport <项目ID> <文件路径> --role speech|reference|custom --kind audio|video|image\nshow [项目ID]                    读取实际状态\ninspect <项目ID>                 解码检查／提取关键帧证据\naccept <任务ID>                  接收或重试任务\nrough <项目ID> <JSON文件>         提交粗剪建议和真实逐句转写\nconfirm-rough <项目ID> --version N --confirmation 用户确认原话\nplan <项目ID> <JSON文件> --task 任务ID\nanalysis <项目ID> <JSON文件> --task 任务ID\nrender <项目ID> --task 任务ID     渲染任务对应的样片或完整版\nverify <项目ID>                  完整版解码核验\nfail <任务ID> --error 失败原因\nrecover <任务ID>                 仅在旧执行进程已停止后恢复中断任务\nexport <项目ID> --out 文件路径   导出可恢复项目清单\n\n粗剪确认必须来自用户在对话中的明确批准；不能由 Agent 代替批准。`);
  } else {
    const engine=await new Engine(data).init();
    if(command==='serve'){const server=await serve(engine,{port:Number(options.port||4319)});console.log(`老董智能剪辑：http://127.0.0.1:${server.address().port}/\n数据：${data}\n保持此进程运行。`);}
    else if(command==='doctor'){
      const result={node:process.version,data,dependencies:[],interruptedTasks:[],lock:null};
      for(const name of ['ffmpeg','ffprobe']){try{const r=await run(name,['-version']);if(name==='ffmpeg'){const filters=(await run(name,['-filters'])).stdout;for(const filter of ['ass','overlay','select','showinfo','color','silencedetect','concat'])check(new RegExp(`\\s${filter}\\s`).test(filters),`FFmpeg 缺少 ${filter} 过滤器；请使用包含 libass 的完整版本。`,400);}result.dependencies.push({name,path:await binary(name),ok:true,version:r.stdout.split('\n')[0]});}catch(e){result.dependencies.push({name,ok:false,error:e.message});}}
      const s=await engine.state();result.interruptedTasks=s.tasks.filter(t=>['accepted','running','rendering'].includes(t.status)).map(t=>({id:t.id,status:t.status,projectId:t.projectId,instruction:'先确认原执行进程是否仍在运行；已停止才可 recover，然后 accept 重试。'}));
      try{result.lock=JSON.parse(await fs.readFile(path.join(data,'.state.lock'),'utf8'));}catch{}
      print(result);if(result.dependencies.some(d=>!d.ok))process.exitCode=1;
    }
    else if(command==='create')print(await engine.create({templateId:options.template,templateVersion:options['template-version']?Number(options['template-version']):undefined,name:options.name}));
    else if(command==='show')print(a?await engine.project(a):await engine.state());
    else if(command==='import-demo')print(await importDemo(engine,await read(a)));
    else if(command==='upgrade-builtin')print(await engine.upgradeBuiltin(a,options.reason));
    else if(command==='import')print(await engine.importAsset(a,b,{role:options.role,kind:options.kind}));
    else if(command==='inspect')print(await engine.inspect(a));
    else if(command==='task')print(await engine.task(a,{type:options.type,context:options.context,opinionIds:typeof options.opinions==='string'?options.opinions.split(','):[]}));
    else if(command==='accept')print(await engine.taskStatus(a,'accept'));
    else if(command==='rough')print(await engine.rough(a,await read(b)));
    else if(command==='confirm-rough')print(await engine.confirmRough(a,Number(options.version),options.confirmation));
    else if(command==='plan')print(await engine.plan(a,await read(b),options.task));
    else if(command==='analysis')print(await engine.analysis(a,await read(b),options.task));
    else if(command==='render')print(await engine.render(a,options.task));
    else if(command==='verify')print(await engine.verify(a));
    else if(command==='fail')print(await engine.taskStatus(a,'fail',options.error));
    else if(command==='recover')print(await engine.recover(a));
    else if(command==='cancel')print(await engine.cancelTask(a,options.reason));
    else if(command==='export'){check(typeof options.out==='string','请提供 --out 文件路径',400);const project=await engine.project(a);await fs.writeFile(path.resolve(options.out),JSON.stringify({schemaVersion:1,project,tasks:(await engine.state()).tasks.filter(t=>t.projectId===a)},null,2));print({path:path.resolve(options.out),note:'包含素材与成片绝对路径；移动项目时应复制完整数据目录，清单本身不内嵌媒体。'});}
    else check(false,'未知命令，运行 help 查看用法',400);
  }
}catch(e){console.error(JSON.stringify({error:e.message}));process.exitCode=1;}
