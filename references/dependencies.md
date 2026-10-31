# 依赖检查、官方入口与语音识别

本文供执行安装与制作的 Agent 读取，不要求新手自行操作。安装后、首个有声制作任务前分别检查；不要把“工作台能打开”等同于“语音识别已可用”。

## 复用优先

1. 检查已有 Node、FFmpeg/FFprobe、中文字体与能返回真实时间戳的 ASR。优先复用已安装且可用的工具，不重复下载模型。
2. 缺少基础依赖时，在宿主权限内协助安装并验证；需要用户操作时只说当前必须的一步。不要要求普通用户逐一挑选依赖。
3. ASR 是有声口播制作的必要能力；已有可靠的带时间字幕可替代重新识别。宿主的文字聊天能力不等于能听音或产生真实时间戳。

## 官方下载入口

- Node.js：https://nodejs.org/en/download ，选择仍受支持的 LTS 且满足本包 Node >=20 的要求。
- FFmpeg 与 FFprobe：https://ffmpeg.org/download.html 。Windows 编译包入口由该官网链接提供：https://www.gyan.dev/ffmpeg/builds/ 。选择包含 libass 的完整构建，检查 `ffmpeg -filters` 的 ass 等所需过滤器及 `ffprobe -version`。PyAV 随带解码库不替代本包的完整 FFmpeg/FFprobe。
- 中文字体：先复用系统可用中文字体；缺少时使用 Noto CJK 官方仓库：https://github.com/notofonts/noto-cjk 。核验渲染无方框。
- Python（仅本地 ASR 方案需要）：https://www.python.org/downloads/ ，选与实际 faster-whisper/CTranslate2 轮子兼容的受支持 Python 版本，使用独立虚拟环境，不盲目选择最新版本。
- 开源 ASR 引擎 faster-whisper：https://github.com/SYSTRAN/faster-whisper ，安装方式 `python -m pip install faster-whisper`（在专用虚拟环境中）。
- 多语种 small 模型：https://huggingface.co/Systran/faster-whisper-small 。普通 CPU 首轮可试用 small + int8；不要用仅英语的 small.en 识别中文。质量不足时再结合机器性能换大模型，不把某个模型承诺为所有机器的最佳选择。

## 缺少 ASR 时的本地方案

有声任务在没有现成 ASR 时，由 Agent 配置上述 faster-whisper。不要把模型权重打进 Skill 包，模型存放于独立缓存目录，记录解释器与模型目录供后续复用。首次下载需联网；下载失败时保留已有环境并准确说明具体阻碍，不伪造识别结果。无 GPU 时默认尝试 CPU int8，GPU 仅在验证当前官方 CUDA/cuDNN/CTranslate2 兼容要求后使用。不要擅自上传音频到云端或申请付费服务。

最小调用参考（由 Agent 写入项目工作目录的脚本并执行）：

```python
from faster_whisper import WhisperModel
model = WhisperModel('small', device='cpu', compute_type='int8')
segments, info = model.transcribe('实际音频路径', language='zh', beam_size=5)
rows = [{'start': s.start, 'end': s.end, 'text': s.text.strip()} for s in segments]
```

使用真实输入，完整迭代 segments 才会实际执行识别。多语种按实际语言设置，不把中文配置强加到其他语言。模型可首次自动下载；已有完整模型目录时直接传入本地目录。以上是 Agent 调用外部 ASR 的参考流程，本包 CLI 尚未内置自动下载或 ASR 命令，doctor 也不检查 ASR；不得把说明误报为已集成、已安装或已完成识别。

用用户实际素材的短段验证非空转写及合理起止时间，检查中文、数字、专名和音画同步。降采样但未剪切的 listening.wav 时间仍对应原素材；如先裁切，必须加回真实裁切偏移。按 contracts.md 转换为粗剪 JSON，保留原素材时间。听取校验、粗剪确认与样片审批仍按 SKILL.md，不能自动批准。

已核对上述官方入口（2026-10-31）；具体平台安装成功和识别速度以目标机器实际验证为准。
