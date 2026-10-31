import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const id = prefix => `${prefix}-${randomUUID()}`;
export const now = () => new Date().toISOString();
export function check(ok, message, status = 409) {
  if (!ok) throw Object.assign(new Error(message), {status});
}
export async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), {flag: 'wx'});
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, {force: true}); }
}
export function inside(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export class Store {
  constructor(root) { this.root = path.resolve(root); this.file = path.join(this.root, 'state.json'); }
  async read() { return JSON.parse(await fs.readFile(this.file, 'utf8')); }
  async init(template) {
    await fs.mkdir(this.root, {recursive: true});
    await this.transaction(async s => {
      const old=s.templates.find(t=>t.id===template.id);
      if(!old)s.templates.push(template);
      else if(template.current>old.current){for(const v of template.versions)if(!old.versions.some(x=>x.version===v.version))old.versions.push(v);old.current=template.current;old.name=template.name;}
      // Naming-only migration: keep project rules, outputs and approvals intact.
      const legacy=/\u5927\u53f8\u9a6c/;
      const normalize=t=>{
        if(!t||t.id!==template.id)return;
        if(legacy.test(t.name||''))t.name=template.name;
        const clean=v=>{if(typeof v.origin==='string')v.origin=v.origin.replace(/\u5927\u53f8\u9a6c(?:动效)?布局/g,'干货讲解竖屏模板');if(v.rules?.scope)v.rules.scope=v.rules.scope.replace(/\u5927\u53f8\u9a6c外框/g,'干货讲解竖屏模板的布局框架');};
        clean(t);for(const v of t.versions||[])clean(v);
      };
      for(const t of s.templates)normalize(t);
      for(const p of s.projects)normalize(p.template);
    });
  }
  async transaction(fn) {
    const lock = path.join(this.root, '.state.lock');
    let handle;
    for (let tries = 0; !handle; tries++) {
      try { handle = await fs.open(lock, 'wx'); }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let recovery;
        try {
          // Serialize stale-lock cleanup and re-read the owner under that guard.
          recovery=await fs.open(`${lock}.recovery`,'wx');
          const stale=JSON.parse(await fs.readFile(lock,'utf8'));
          if(Number.isInteger(stale.pid)&&stale.pid>0){
            try {process.kill(stale.pid,0);}catch(alive){if(alive.code==='ESRCH')await fs.rm(lock,{force:true});}
          }
        } catch {} finally {if(recovery){await recovery.close();await fs.rm(`${lock}.recovery`,{force:true});}}
        check(tries < 100, '数据正在被其他进程使用；若进程异常退出，请先运行 doctor 检查锁文件。', 503);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    try {
      await handle.writeFile(JSON.stringify({pid: process.pid, created: now()}));
      let state;
      try { state = await this.read(); }
      catch (e) { if (e.code !== 'ENOENT') throw e; state = {schemaVersion: 1, revision: 0, templates: [], projects: [], tasks: []}; }
      const result = await fn(state);
      state.revision++; state.updated = now();
      await atomic(this.file, state);
      return result;
    } finally { await handle.close(); await fs.rm(lock, {force: true}); }
  }
}
