# 命令、任务与文件约定

所有命令以 `node <skill绝对路径>/scripts/cli.mjs` 开始；同一项目始终附加 `--data <数据目录绝对路径>`。所有 JSON 为 UTF-8（兼容 BOM）。命令通过标准输出返回 JSON；失败退出码为1。

## 数据

`state.json` 是唯一事务状态源，原子写入、跨进程排他锁。包含 `templates`（全部版本）、`projects` 和 `tasks`。不要手改。

```text
<数据目录>/
  state.json
  templates/<模板ID>/v<版本>.json     用户确认模板的不可变导出
  tasks/<任务ID>/request.json         创建时的不可变请求快照
  projects/<项目ID>/
    assets/                          保存成功的素材副本；中断上传自动清理
    inspection/assets-<修订>/        完整解码结果、停顿建议、listening.wav
    evidence/assets-<修订>/          参考片段与起中末证据帧
    renders/<输出ID>/                video.mp4、poster.jpg、剪后音视频、ASS及结果
```

每个视频的 `template` 包含 ID、名称、版本、已确认规则完整快照。改模板名称／版本不改已有项目。`assetRevision` 变更使依赖旧素材的任务、规划和审批失效；历史文件与决定保留。自定义素材变更保留仍有效的讲解检查和粗剪确认。

`outputs` 保留历次真实成片，`currentOutput` 指向本次审核对象。失败仍保留上一有效输出。样片与完整版版本独立递增，意见带 `context`、`baseVersion`、`elementId`、范围与状态；不可跨上下文处理。

## CLI

```text
doctor
serve --port 4319
create --template knowledge-sharing --name 我的项目
create                                     # 新参考项目
import <项目ID> <文件路径> --role speech --kind audio
import <项目ID> <文件路径> --role speech --kind video
import <项目ID> <文件路径> --role reference --kind video
import <项目ID> <文件路径> --role custom --kind image
import <项目ID> <文件路径> --role custom --kind video
show [项目ID]
inspect <项目ID>
task <项目ID> --type start|analyze|full
task <项目ID> --type revise --context template|sample|full --opinions 意见ID1,意见ID2
accept <任务ID>
rough <项目ID> <rough.json>
confirm-rough <项目ID> --version 1 --confirmation 用户确认原话
plan <项目ID> <plan.json> --task <任务ID>
analysis <项目ID> <analysis.json> --task <任务ID>
render <项目ID> --task <任务ID>
verify <项目ID>
fail <任务ID> --error 具体原因
recover <任务ID>
export <项目ID> --out <清单文件路径>
```

`task --type full` 同样经过服务端版本审批检查，不能绕过页面批准。`accept` 为互斥接收；重复接收被拒绝，失败重试允许再次接收。中断任务先确认旧进程已退出再 recover。

## 粗剪 JSON

`keep`、`cues` 都用**原素材秒数**，非剪后秒数。区间升序、不重叠；字幕不能跨切点。删掉整句时可保留原转写作为证据，运行时只把完全保留的句子映射到剪后时间。`transcriptSource` 只能为 `user`、`asr`、`agent-listening`，如实记录实际来源。

```json
{
  "transcriptSource": "user",
  "note": "示例结构，必须换成用户自己的真实逐句时间与内容",
  "keep": [{"start": 0, "end": 4}, {"start": 5, "end": 8}],
  "cues": [
    {"start": 0, "end": 4, "text": "第一句实际讲解。"},
    {"start": 5, "end": 8, "text": "第二句实际讲解。"}
  ],
  "decisions": [{"start": 4, "end": 5, "reason": "需用户确认的候选停顿"}]
}
```

用户批准后生成 `rough.timeline`，第二句变为4—7秒。录音和人物视频共享 `keep`，FFmpeg 同时裁切声音与视频；不调整语速。

## 画面规划 JSON

写完整讲解规划，运行时只渲染前10秒。`scenes` 连续覆盖 `rough.duration`。`type` 必须属于项目模板的 `sceneTypes`。

```json
{
  "scenes": [
    {"id": "intro", "start": 0, "end": 4, "type": "focus", "title": "先选一个重复任务", "items": ["从每周都要做的事情开始"]},
    {"id": "steps", "start": 4, "end": 7, "type": "steps", "title": "拆成三个环节", "items": ["输入", "处理", "输出"], "overrides": {"titleSize": 44}}
  ]
}
```

- `list`、`steps`、`focus`：最多5项；长文字自动换行，放不下则拒绝渲染，需拆段或精炼画面文字。
- `media`：必须带已保存自定义素材的 `assetId`，最多1条短说明。图片静态铺满素材区；B-roll 循环至片段结束，配音仍取自己的剪后声音。
- `bar`：`values` 与 `items` 一一对应，数值0—1。来源须为真实数据；不可为方便视觉而编造。
- `overrides` 目前支持 `titleSize`、`cardSize`、`captionSize`（16—100）。首版的布局、配色、动画由模板快照控制。需要更复杂变化先扩展代码，不静默忽略字段。
- 稳定元素 ID 为 `<scene.id>/title|cards|caption|person|media|background`；新规划保留仍属于同一内容的片段ID。

首版渲染器：FFmpeg + ASS/libass，H.264/AAC MP4，模板尺寸360—1920像素偶数、24/25/30fps、色值 `#RRGGBB`。淡入与卡片依次出现遵守 `motion`。文字、卡片、条形图为代码生成；自定义图片／视频与同步人物小窗独立合成。

## 拆解 JSON

```json
{
  "observations": ["第0秒、2秒和4秒均能看到顶部标题，左侧边距约为7%。"],
  "inferences": ["标题可能为独立文字层；原片源工程不可恢复，遮挡部分未知。"],
  "scenes": [{"id": "opening", "start": 0, "end": 5, "title": "开场说明"}],
  "elements": [{"id": "title", "name": "顶部标题", "description": "深色大字，位于顶部", "production": "代码可以直接做好", "box": [0.07, 0.06, 0.86, 0.15], "start": 0, "end": 5}],
  "rules": {}
}
```

`rules` 的完整可执行结构参见 `templates/knowledge.json` 中 `versions[0].rules`；不要提交空对象。`layout` 五个区域采用归一化 `x,y,width,height`。必须填写 `production`、`scope` 和真实观察，不直接把内置规则冒充新参考的分析。实际参考的方向或尺寸不同应调整相应规则。

## 本地 HTTP

仅绑定127.0.0.1。页面读取 `/api/session` 取得当前进程令牌；所有写操作带 `X-Laodongcut-Token`，校验 Host 与 Origin，无跨域通配。Agent 优先 CLI，无需模拟浏览器接口。

`GET /api/state` 读取真实状态；页面每1.5秒检查版本。`POST /api/projects` 建项目；项目下 `assets` 流式保存文件（上限500MB）后登记绝对路径，`task` 创建持久任务，`draft/opinion/dismiss/discard-draft` 管理草稿和意见，`approve` 绑定当前样片批准，`confirm-template` 保存确认模板并进入新视频。`/media` 只服务数据目录内的允许媒体类型，支持 Range。

没有 HTTP 接口允许用户“模拟返回”；实际分析与渲染通过 CLI 验证结果后提交。暂存、复制、接收、执行、已返回、失败分开。导出的项目 JSON 引用媒体绝对路径；移动备份应复制完整数据目录，而非只复制 JSON。


## v0.2 内置动效模板

新项目默认使用干货讲解竖屏模板 v3（原生1080×1920），规划格式及内容编排规则见 references/content-direction.md。本文旧版 list/steps/focus/media/bar 规划例子只适用于v1；复现旧示例时创建项目加 `--template-version 1`。旧项目快照保持不变。用户要求升级旧项目时使用 `upgrade-builtin <项目ID> --reason "用户要求" --data <数据目录>`，然后通过真实修改任务重新规划和渲染。不得把v1纯文字规划直接用于v3。

通用模板v3默认不生成任何品牌页脚。每条规划需提供按内容设计的theme，背景、分隔线、人物边框和内容元素配色不再固定。


全局视频意见复用原opinion/draft及revise任务：scope为video，elementId为null，start=0，end为整段剪后内容时长（样片只显示前10秒也仍针对整片）。scene/all仍表示选定元素的当前片段或全片同类元素，不能与video混用。Agent接收video意见时按完整规划理解，不限于当前显示片段。
