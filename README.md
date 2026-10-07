# 生活垃圾焚烧发电厂运行管理平台

面向垃圾进厂计量、垃圾池管理、焚烧炉与余热锅炉运行、汽轮发电机组、烟气净化与在线排放监测、飞灰固化与炉渣处理、渗滤液处理、设备点检检修与值班交接的一体化生活垃圾焚烧发电厂运行管理工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 垃圾进厂计量 | `weighbridge` | 进厂计量单 | 计量单号、进场车牌、垃圾来源 |
| 垃圾池管理 | `pit` | 垃圾池区 | 池区编号、垃圾存量、发酵天数 |
| 焚烧炉运行 | `incinerator` | 焚烧炉运行记录 | 运行编号、炉膛温度、炉膛负压 |
| 余热锅炉运行 | `boiler` | 余热锅炉记录 | 锅炉编号、主蒸汽压力、主蒸汽温度 |
| 汽轮发电机组 | `turbine` | 发电机组运行记录 | 机组编号、机组转速、发电功率 |
| 烟气净化运行 | `fluegas` | 烟气净化记录 | 净化编号、反应塔温度、活性炭喷射量 |
| 在线排放监测 | `cems` | 排放监测记录 | 监测编号、监测因子、实测值 |
| 飞灰固化处置 | `flyash` | 飞灰固化批次 | 固化编号、飞灰来源、螯合剂用量 |
| 炉渣处理 | `slag` | 炉渣处理记录 | 处理编号、炉渣产量、热灼减率 |
| 渗滤液处理 | `leachate` | 渗滤液处理记录 | 处理编号、进水水量、出水水量 |
| 设备点检 | `equipcheck` | 设备点检记录 | 点检编号、点检设备、点检部位 |
| 设备检修管理 | `overhaul` | 检修记录 | 检修编号、检修设备、检修类别 |
| 备件台账管理 | `spare` | 备品备件 | 备件编号、备件名称、规格型号 |
| 发电量统计 | `powerstat` | 发电量统计记录 | 统计编号、统计周期、发电量 |
| 环保指标监控 | `emission` | 环保监控记录 | 监控编号、监控指标、限值要求 |
| 值班交接班 | `shift` | 交接班记录 | 交接编号、值班班组、班次 |
| 应急预案管理 | `safetyplan` | 应急预案 | 预案编号、预案名称、适用事故 |
| 安全培训管理 | `training` | 培训记录 | 培训编号、培训主题、培训对象 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `waste-to-energy-plant:entries` 这一项（还有
  `waste-to-energy-plant:meta` 版本号），或调用 `resetModule(模块)`。

## 飞灰固化整组检测

飞灰固化一批几十个，逐条点返工太慢，因此在飞灰固化处置页提供整组处置：

- 勾选多条「固化中（待检测）」批次，逐条给检测结论（合格 / 不合格），一次「整组确认检测」落表。
- 落表后**逐条回报**：哪几条判成「已检测」、哪几条判成「需返工」、哪几条因为螯合剂用量或
  水泥用量没填全被挡回「待固化」、哪几条是重报只算一次，回报面板一类一条列清楚。
- 被挡的批次不会消失：显式写回「待固化」队列，补齐用量后再报；还没进料（本来就在待固化）的
  不受理整组检测。
- 已经收下（已检测）的批次不许整组撤回，重报同一只算第一次；返工后复检可以再次收下。
- 固化块批次进入「已检测/需返工」后，运营概览的「飞灰待返工批次」等指标按库内状态实时重算；
  每条检测结论同步生成一条环保监控「待复核」记录（按来源固化编号去重）。
- 两个班组（两个浏览器标签页）抢同一批时，按模块版本号做乐观锁：先入库的那一版说了算，
  后提交的整组拒收、不写入任何结论，页面提示后按最新数据重报。

业务逻辑都在 `frontend/src/api/local-service.ts` 的 `groupInspectFlyash`；`src/test-harness/`
下有一个不依赖浏览器的本地验证脚本（需要平台匹配的 esbuild 二进制）：

```bash
node src/test-harness/driver.mjs reset   # 播种
node src/test-harness/driver.mjs main    # 整组检测主场景断言
# 两个进程抢同一批：
node src/test-harness/driver.mjs race-a 300 & node src/test-harness/driver.mjs race-b 400 & wait
node src/test-harness/driver.mjs check
```
