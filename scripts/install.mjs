import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.resolve(process.argv[2]||path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'skills','laodongcut'));
const names=['SKILL.md','README.md','README.en.md','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md','docs','LICENSE','package.json','start.cmd','agents','app','lib','scripts','references','templates','examples','tests'];
const exists=async p=>fs.lstat(p).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
async function regularTree(p){const s=await fs.lstat(p);if(s.isSymbolicLink())throw Error('安装范围包含链接，请检查：'+p);if(s.isDirectory())for(const n of await fs.readdir(p))await regularTree(path.join(p,n));}
let backup;const changed=[];
try{
 if(source===target)throw Error('请从新下载包的临时解压目录运行安装器。');
 const installed=await exists(target);
 if(installed){if((await fs.lstat(target)).isSymbolicLink())throw Error('目标是链接，请核对真实安装位置。');const pkg=JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8'));if(pkg.name!=='laodongcut')throw Error('目标不是 laodongcut，拒绝覆盖。');}
 for(const n of names){await regularTree(path.join(source,n));if(await exists(path.join(target,n)))await regularTree(path.join(target,n));}
 if(installed){backup=await fs.mkdtemp(path.join(path.dirname(target),'laodongcut-backup-'));for(const n of names)if(await exists(path.join(target,n)))await fs.cp(path.join(target,n),path.join(backup,n),{recursive:true});}
 await fs.mkdir(target,{recursive:true});
 for(const n of names){changed.push(n);await fs.cp(path.join(source,n),path.join(target,n),{recursive:true,force:true});}
 const version=JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8')).version;
 console.log(JSON.stringify({action:installed?'updated':'installed',version,folder:target,backup,note:'项目、素材、配置与 data 均保留。请 Agent 检查依赖、打开工作台；首次使用时逐步引导。'},null,2));
}catch(e){if(backup)for(const n of changed)if(await exists(path.join(backup,n)))await fs.cp(path.join(backup,n),path.join(target,n),{recursive:true,force:true});console.error(e.message);process.exitCode=1;}
