import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {check, atomic} from './store.mjs';

export async function binary(name) {
  if (process.env[`LAODONGCUT_${name.toUpperCase()}`]) return process.env[`LAODONGCUT_${name.toUpperCase()}`];
  if(name==='ffmpeg') {
    const imageio=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','Lib','site-packages','imageio_ffmpeg','binaries');
    try{const found=(await fs.readdir(imageio)).find(f=>/^ffmpeg.*\.exe$/.test(f));if(found)return path.join(imageio,found);}catch{}
    // On ordinary installations use the full system build, not Remotion's reduced build.
    return name;
  }
  // Optional reuse of an already installed runtime; no machine-specific path is required.
  const base = path.join(os.homedir(), '.codex', 'skills', 'auto-video-all-in-one', 'runtime', 'remotion-template', 'node_modules');
  const platform = process.platform === 'win32' ? 'win32-x64-msvc' : process.platform === 'darwin' ? `darwin-${process.arch}` : `linux-${process.arch}-gnu`;
  const candidate = path.join(base, '@remotion', `compositor-${platform}`, name + (process.platform === 'win32' ? '.exe' : ''));
  try { await fs.access(candidate); return candidate; } catch { return name; }
}
export async function run(name, args, options = {}) {
  const exe = name === 'ffmpeg' || name === 'ffprobe' ? await binary(name) : name;
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args.map(String), {windowsHide: true, cwd: options.cwd, stdio: ['ignore','pipe','pipe']});
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${name} 超时；请检查媒体或缩短单次任务。`)); }, options.timeout || 600000);
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-8_000_000); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-400_000); });
    child.on('error', e => { clearTimeout(timer); reject(new Error(`无法调用 ${name}：${e.message}。运行 doctor 检查依赖。`)); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({stdout, stderr}) : reject(new Error(`${name} 执行失败：${stderr.slice(-5000)}`)); });
  });
}
export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function probe(file, {decode = false} = {}) {
  const stat = await fs.stat(file);
  check(stat.isFile() && stat.size > 0, '素材为空或不是文件', 400);
  const info = JSON.parse((await run('ffprobe', ['-v','error','-show_format','-show_streams','-of','json',file])).stdout);
  const audio = info.streams.find(s => s.codec_type === 'audio');
  const video = info.streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const duration = Number(info.format.duration || video?.duration || audio?.duration || 0);
  if (decode) await run('ffmpeg', ['-v','error','-xerror','-i',file,'-map','0:v?','-map','0:a?','-f','null','-']);
  return {size: stat.size, duration, audio: !!audio, video: !!video, width: video?.width, height: video?.height, sampleRate: audio?.sample_rate, sha256: await hashFile(file)};
}
export async function inspectSpeech(asset, folder) {
  const info = await probe(asset.path, {decode: true});
  check(info.audio && info.duration > 0, '讲解素材必须包含可解码的声音和有效时长', 400);
  check(asset.kind !== 'video' || info.video, '人物口播素材必须包含视频', 400);
  const {stderr} = await run('ffmpeg', ['-hide_banner','-i',asset.path,'-af','silencedetect=noise=-35dB:d=0.7','-vn','-f','null','-']);
  const silences = []; let start = null;
  for (const match of stderr.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
    if (match[1] === 'start') start = +match[2];
    else if (start !== null) { silences.push({start, end: +match[2], suggestion: '候选停顿；请结合语义决定是否保留'}); start = null; }
  }
  if (start !== null && start < info.duration) silences.push({start, end: info.duration, suggestion: '尾部候选停顿；需人工确认'});
  await fs.mkdir(folder, {recursive: true});
  await run('ffmpeg', ['-v','error','-y','-i',asset.path,'-vn','-ac','1','-ar','16000',path.join(folder, 'listening.wav')]);
  const result = {...info, silences, listeningPath: path.join(folder, 'listening.wav'), transcript: null, note: '声学停顿不是口误判断；转写必须来自听取、ASR 或用户提供，并回听核验。'};
  await atomic(path.join(folder,'inspection.json'), result);
  return result;
}
export async function inspectReference(asset, folder) {
  const info = await probe(asset.path, {decode: true});
  check(info.video && info.duration > 0, '参考素材必须为可解码的视频', 400);
  await fs.mkdir(folder, {recursive: true});
  const detected = await run('ffmpeg', ['-hide_banner','-i',asset.path,'-vf',"select='gt(scene,0.30)',showinfo",'-an','-f','null','-']);
  const changes = [...detected.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m=>+m[1]).filter(t=>t>0.15 && t<info.duration-0.15);
  // Long unchanged shots still need additional temporal evidence.
  for (let t=5; t<info.duration; t+=5) changes.push(t);
  const boundaries = [0,...changes.sort((a,b)=>a-b).filter((t,i,a)=>!i || t-a[i-1]>.15),info.duration];
  check(boundaries.length <= 302, '参考视频过长，请先截取需要参考的一段（最多约25分钟）。', 400);
  const scenes = [];
  for (let i=0; i<boundaries.length-1; i++) {
    const start=boundaries[i], end=boundaries[i+1], frames=[];
    for (const [j,time] of [start+.02,(start+end)/2,Math.max(start,end-.06)].entries()) {
      const file=path.join(folder,`scene-${i+1}-${j+1}.jpg`);
      await run('ffmpeg',['-v','error','-y','-ss',Math.min(time,info.duration-.03),'-i',asset.path,'-frames:v','1','-vf','scale=480:-2',file]);
      frames.push({time,path:file});
    }
    scenes.push({id:`scene-${i+1}`,start,end,frames});
  }
  const result={...info,scenes, note:'切镜检测与定时采样仅提供证据；元素结构、遮挡推断、布局和动效规则由 Agent 对照这些帧及原视频填写。'};
  await atomic(path.join(folder,'evidence.json'),result);
  return result;
}
