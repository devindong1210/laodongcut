import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {bundle} from './engine.mjs';
import {inside,check} from './store.mjs';

async function jsonBody(req) {
  let size=0;const chunks=[];
  for await(const c of req){size+=c.length;check(size<=1024*1024,'请求过大',413);chunks.push(c);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{check(false,'JSON格式错误',400);}
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.flac':'audio/flac','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
async function sendFile(req,res,file,type,download=false) {
  const stat=await fs.stat(file);check(stat.isFile(),'文件不存在',404);let start=0,end=stat.size-1,status=200;
  if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);check(match&&(match[1]||match[2]),'不支持这个范围',416);if(!match[1])start=Math.max(0,stat.size-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Number(match[2]);}check(start<=end&&start<stat.size,'请求范围超出文件',416);end=Math.min(end,stat.size-1);status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`);}
  res.setHeader('Content-Type',type);res.setHeader('Content-Length',end-start+1);res.setHeader('Accept-Ranges','bytes');if(download)res.setHeader('Content-Disposition',"attachment; filename=laodongcut.mp4");res.writeHead(status);
  if(req.method==='HEAD'){res.end();return;}
  const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}
export async function serve(engine,{port=4319}={}) {
  const token=randomBytes(32).toString('hex');
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    try {
      const host=req.headers.host,actual=server.address().port;
      check([`127.0.0.1:${actual}`,`localhost:${actual}`].includes(host),'只允许本机访问',403);
      const url=new URL(req.url,`http://${host}`),route=url.pathname;
      if(!['GET','HEAD'].includes(req.method)){
        check(!req.headers.origin||[`http://127.0.0.1:${actual}`,`http://localhost:${actual}`].includes(req.headers.origin),'来源不被允许',403);
        check(req.headers['x-laodongcut-token']===token,'页面凭证无效，请刷新',403);
      }
      if(req.method==='GET'&&route==='/api/session')return send({token,root:engine.root,hostBridge:{codex:false,workbuddy:false,mode:'copy',reason:'尚无经验证可路由到当前对话的通用接口；复制后粘贴到当前对话。'}});
      if(req.method==='GET'&&route==='/api/state')return send(await engine.state());
      if(['GET','HEAD'].includes(req.method)&&route==='/media') {
        const file=path.resolve(url.searchParams.get('path')||''),ext=path.extname(file).toLowerCase();check(inside(engine.root,file)&&mime[ext]&&ext!=='.html'&&ext!=='.js'&&ext!=='.css','不允许访问这个文件',403);
        const real=await fs.realpath(file);check(inside(await fs.realpath(engine.root),real),'文件超出数据目录',403);return sendFile(req,res,real,mime[ext],url.searchParams.has('download'));
      }
      if(['GET','HEAD'].includes(req.method)&&['/','/app.js','/style.css'].includes(route)){const file=route==='/'?'index.html':route.slice(1);return sendFile(req,res,path.join(bundle,'app',file),mime[path.extname(file)]);}
      if(req.method==='POST'&&route==='/api/projects')return send(await engine.create(await jsonBody(req)),201);
      const match=/^\/api\/projects\/(p-[a-f\d-]{36})\/([a-z-]+)$/.exec(route);
      if(req.method==='POST'&&match){const [,pid,action]=match;
        if(action==='assets'){
          await engine.project(pid);let name;try{name=decodeURIComponent(req.headers['x-file-name']||'素材');}catch{check(false,'文件名编码无效',400);}
          const ext=path.extname(name).toLowerCase();check(mime[ext]&&!['.html','.css','.js'].includes(ext),'请选择常见录音、视频或图片格式',400);
          const dest=engine.folder(pid,'assets',`${randomUUID()}${ext}`),temp=`${dest}.uploading`;let size=0;
          const upload=await engine.uploadStart(pid,name,temp);
          const limit=new Transform({transform(chunk,enc,cb){size+=chunk.length;size>500*1024*1024?cb(Object.assign(new Error('素材超过500 MB'),{status:413})):cb(null,chunk);}});
          try {await pipeline(req,limit,createWriteStream(temp,{flags:'wx'}));check(size>0,'文件为空',400);await fs.rename(temp,dest);const item=await engine.register(pid,dest,{name,role:url.searchParams.get('role'),kind:url.searchParams.get('kind'),expectedRevision:url.searchParams.has('revision')?Number(url.searchParams.get('revision')):undefined});await engine.uploadEnd(pid,upload.id,{assetId:item.id});return send(item,201);}
          catch(e){await fs.rm(temp,{force:true});await fs.rm(dest,{force:true});await engine.uploadEnd(pid,upload.id,{error:e.message});throw e;}
        }
        const doc=await jsonBody(req);
        if(action==='task')return send(await engine.task(pid,doc));
        if(action==='draft')return send(await engine.draft(pid,doc));
        if(action==='opinion')return send(await engine.opinion(pid,doc));
        if(action==='dismiss')return send(await engine.dismissOpinion(pid,doc.id,doc.reason));
        if(action==='discard-draft')return send(await engine.discardDraft(pid,doc.key));
        if(action==='confirm-template'){const result=await engine.confirmTemplate(pid,doc.name);return send({...result,project:await engine.create({templateId:result.templateId})});}
        if(action==='approve')return send(await engine.approveSample(pid,doc.outputId));
      }
      if(req.method==='POST'&&route==='/api/task-copied'){const d=await jsonBody(req);return send(await engine.taskStatus(d.id,'copied'));}
      if(req.method==='POST'&&route==='/api/task-cancel'){const d=await jsonBody(req);return send(await engine.cancelTask(d.id,d.reason));}
      if(req.method==='POST'&&route==='/api/template-name'){const d=await jsonBody(req);return send(await engine.renameTemplate(d.id,d.name));}
      check(false,'没有这个入口',404);
    }catch(e){if(!res.headersSent&&!res.destroyed)send({error:e.code==='ENOENT'?'文件不存在或已移动':e.message},e.status||500);else if(!res.destroyed)res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return server;
}
