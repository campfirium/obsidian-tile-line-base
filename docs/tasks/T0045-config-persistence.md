# T0045-config-persistence

## 任务目标

在文件底部添加 `tlb` 代码块，存储**所有语义以外的数据**（过滤视图设置、自定义列宽等），实现单文件实例的完整自包含。


## 技术方案

### 方案设计

在文件**底部**添加 `tlb-config` 代码块，存储所有运行时配置：

```markdown
## 条目1：内容A
字段1：值1
字段2：值2

## 条目2：内容B
字段1：值3

<!-- 文件底部 -->
```tlb
{
  "filterViews": {
    "views": [
      {
        "id": "view-1",
        "name": "进行中",
        "filterRule": {
          "conditions": [
            { "column": "status", "operator": "equals", "value": "doing" }
          ],
          "combineMode": "AND"
        },
        "columnState": null,
        "quickFilter": null
      }
    ],
    "activeViewId": "view-1"
  },
  "columnWidths": {
    "字段1": 200,
    "字段2": 150
  },
  "viewPreference": "table"
}
```
```

### 数据结构定义

```typescript
interface TlbConfigBlock {
  // 过滤视图设置（来自 filterView.ts）
  filterViews?: {
    views: FilterViewDefinition[];
    activeViewId: string | null;
  };

  // 用户手动调整的列宽（像素）
  columnWidths?: Record<string, number>;

  // 文件视图偏好（是否默认表格模式）
  viewPreference?: 'markdown' | 'table';

  // 预留：其他配置
  [key: string]: unknown;
}
```

### 缓存机制

**缓存文件位置**：`.obsidian/plugins/tile-line-base/file-cache.json`

**工作流程**：

1. **打开文件时**（快速路径）：
   ```
   ┌─ 读取配置块第一行（__meta__）
   │  ├─ 获取 fileId 和 version
   │  └─ 查询缓存（用 fileId）
   │
   ├─ 版本号一致？
   │  ├─ 是 → 直接用缓存渲染（最快路径）✨
   │  └─ 否 → 解析配置块，更新缓存
   │
   └─ 无缓存？
      └─ 解析配置块，创建缓存
   ```

2. **配置修改时**：
   ```
   ┌─ 用户修改配置（过滤视图/列宽等）
   │
   ├─ 更新 version（时间戳）
   │
   ├─ 写入配置块（文件底部）
   │
   └─ 更新缓存（内存 + 磁盘）
   ```

3. **文件重命名时**：
   - `fileId` 不变，缓存仍能匹配
   - 更新缓存中的 `filePath` 字段

### 迁移策略

#### 优先级规则

1. **文件内配置 > 缓存 > 插件全局配置**
   - 如果文件内有 `tlb` 配置块，优先使用
   - 如果没有但有缓存，使用缓存
   - 都没有则回退到插件设置

2. **写回策略**
   - 配置变更时，**同时写入**：配置块 + 缓存 + 插件设置
   - 保证向后兼容（旧版本读取插件设置）

3. **迁移流程**
   - 首次打开文件时，检测是否有 `tlb` 配置块
   - 如果没有但插件设置中有该文件的配置，自动迁移到文件底部
   - 生成 `fileId`（UUID）并写入元数据
   - 同时创建缓存

### 实现步骤

#### 阶段1：缓存系统基础

1. **实现缓存管理器** (`FileCacheManager`)
   - 读取/写入 `file-cache.json`
   - 提供 API：`getCache(fileId)`, `setCache(fileId, config)`, `invalidateCache(fileId)`
   - 内存缓存 + 磁盘持久化

2. **生成文件 ID**
   - 首次打开文件时，检测是否有配置块
   - 如果没有，生成 UUID 作为 `fileId`
   - 写入配置块元数据

#### 阶段2：读取配置块（快速路径）

1. **快速提取元数据**
   - 正则匹配：`/```tlb\s*\n__meta__:(\{.*?\})/`
   - 解析第一行，获取 `fileId` 和 `version`
   - 不解析完整配置块（提升性能）

2. **查询缓存**
   - 用 `fileId` 查询缓存
   - 比较 `version`：
     - 一致 → 直接用缓存渲染 ✨
     - 不一致 → 继续解析配置块

3. **解析完整配置块**
   - 逐行解析：`key:compressedJSON`
   - JSON.parse 解析每行的值
   - 构造 `TlbConfigBlock` 对象

4. **应用配置**
   - `filterViewState`：从配置块加载
   - `columnWidthPrefs`：从配置块加载
   - 视图偏好：决定是否自动打开表格

#### 阶段3：写入配置块

1. **配置变更时写回**
   - `saveFilterView()`、`deleteFilterView()` 等操作时
   - `handleColumnResize()` 列宽调整时
   - 触发 `saveConfigBlock()` 方法

2. **生成配置块内容**
   - 更新 `version`（时间戳）
   - 序列化各配置项：`key:${JSON.stringify(value)}`
   - 第一行：`__meta__:${JSON.stringify({fileId, version})}`
   - 构造 Markdown：` ```tlb\n...\n``` `

3. **写回文件**
   - 移除旧的配置块（正则替换）
   - 在文件末尾追加新配置块
   - 使用 `app.vault.modify()` 写入

4. **同步更新缓存**
   - 更新内存缓存
   - 异步写入 `file-cache.json`

#### 阶段4：兼容性与迁移

1. **自动迁移**
   - 首次渲染时，检测文件是否有 `tlb` 配置块
   - 如果没有，但插件设置中有配置，自动迁移
   - 生成 `fileId` 并写入配置块

2. **向后兼容**
   - 旧版本插件仍能读取插件设置
   - 新版本同时写入文件和插件设置（保险策略）

3. **文件监听**
   - 监听文件变化，重新加载配置块
   - 处理外部编辑（缓存失效）

## 数据示例

### 完整的 TileLineBase 文件示例

```markdown
## 任务：完成T0045任务
价值：100
成本：50
备注：实现配置持久化

## 任务：编写技术文档
价值：80
成本：30
备注：详细规划

```tlb
__meta__:{"fileId":"550e8400-e29b-41d4-a716-446655440000","version":1705123456789}
filterViews:{"views":[{"id":"high-value","name":"高价值","filterRule":{"conditions":[{"column":"价值","operator":"greaterThan","value":"80"}],"combineMode":"AND"}}],"activeViewId":"high-value"}
columnWidths:{"任务":300,"价值":120,"成本":120}
viewPreference:table
```
```

### 缓存文件示例

`.obsidian/plugins/tile-line-base/file-cache.json`:

```json
{
  "550e8400-e29b-41d4-a716-446655440000": {
    "filePath": "path/to/file.md",
    "version": 1705123456789,
    "config": {
      "__meta__": {
        "fileId": "550e8400-e29b-41d4-a716-446655440000",
        "version": 1705123456789
      },
      "filterViews": {
        "views": [
          {
            "id": "high-value",
            "name": "高价值",
            "filterRule": {
              "conditions": [
                { "column": "价值", "operator": "greaterThan", "value": "80" }
              ],
              "combineMode": "AND"
            }
          }
        ],
        "activeViewId": "high-value"
      },
      "columnWidths": {
        "任务": 300,
        "价值": 120,
        "成本": 120
      },
      "viewPreference": "table"
    }
  }
}
```

## 技术要点

### 1. 快速提取元数据（性能优化）

```typescript
private extractMetadata(content: string): TlbConfigMeta | null {
  // 只匹配配置块的第一行（__meta__）
  const metaRegex = /```tlb\s*\n__meta__:(\{[^}]+\})/;
  const match = content.match(metaRegex);

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]) as TlbConfigMeta;
  } catch (error) {
    console.error('Failed to parse metadata:', error);
    return null;
  }
}
```

### 2. 解析完整配置块

```typescript
private parseConfigBlock(content: string): TlbConfigBlock | null {
  // 匹配 ```tlb ... ``` 代码块
  const configBlockRegex = /```tlb\s*\n([\s\S]*?)\n```/;
  const match = content.match(configBlockRegex);

  if (!match) {
    return null;
  }

  const lines = match[1].split('\n');
  const config: any = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 解析 key:value 格式
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.substring(0, colonIndex);
    const valueJson = trimmed.substring(colonIndex + 1);

    try {
      config[key] = JSON.parse(valueJson);
    } catch (error) {
      console.error(`Failed to parse config line: ${key}`, error);
    }
  }

  return config as TlbConfigBlock;
}
```

### 3. 缓存管理器

```typescript
class FileCacheManager {
  private cache: FileCacheData = {};
  private cacheFilePath: string;

  constructor(plugin: Plugin) {
    this.cacheFilePath = `${plugin.manifest.dir}/file-cache.json`;
  }

  async load(): Promise<void> {
    try {
      const data = await this.plugin.loadData();
      this.cache = data?.fileCache ?? {};
    } catch (error) {
      console.error('Failed to load file cache:', error);
      this.cache = {};
    }
  }

  async save(): Promise<void> {
    try {
      const data = await this.plugin.loadData() ?? {};
      data.fileCache = this.cache;
      await this.plugin.saveData(data);
    } catch (error) {
      console.error('Failed to save file cache:', error);
    }
  }

  getCache(fileId: string): TlbConfigBlock | null {
    const cached = this.cache[fileId];
    if (!cached) return null;
    return cached.config;
  }

  setCache(fileId: string, filePath: string, config: TlbConfigBlock): void {
    this.cache[fileId] = {
      filePath,
      version: config.__meta__.version,
      config
    };
    // 异步保存
    this.save().catch(console.error);
  }

  invalidateCache(fileId: string): void {
    delete this.cache[fileId];
    this.save().catch(console.error);
  }
}
```

### 4. 加载配置（带缓存）

```typescript
private async loadConfig(): Promise<TlbConfigBlock> {
  if (!this.file) {
    throw new Error('No file loaded');
  }

  const content = await this.app.vault.read(this.file);

  // 1. 快速提取元数据
  const meta = this.extractMetadata(content);

  if (!meta) {
    // 无配置块，使用默认配置或迁移
    return this.migrateFromPluginSettings();
  }

  // 2. 查询缓存
  const plugin = getPluginContext();
  const cacheManager = plugin?.cacheManager;
  const cached = cacheManager?.getCache(meta.fileId);

  if (cached && cached.__meta__.version === meta.version) {
    // 缓存命中，直接返回 ✨
    console.log('Cache hit for file:', this.file.path);
    return cached;
  }

  // 3. 缓存失效，解析完整配置块
  console.log('Cache miss, parsing config block...');
  const config = this.parseConfigBlock(content);

  if (!config) {
    throw new Error('Failed to parse config block');
  }

  // 4. 更新缓存
  if (cacheManager) {
    cacheManager.setCache(meta.fileId, this.file.path, config);
  }

  return config;
}
```

### 5. 写入配置块

```typescript
private async saveConfigBlock(): Promise<void> {
  if (!this.file) return;

  // 确保有 fileId
  if (!this.fileId) {
    this.fileId = this.generateFileId();
  }

  // 更新版本号
  const version = Date.now();

  // 构造配置块
  const lines: string[] = [];

  // 第一行：元数据
  lines.push(`__meta__:${JSON.stringify({ fileId: this.fileId, version })}`);

  // 其他配置项
  if (this.filterViewState) {
    lines.push(`filterViews:${JSON.stringify(this.filterViewState)}`);
  }
  if (this.columnWidthPrefs) {
    lines.push(`columnWidths:${JSON.stringify(this.columnWidthPrefs)}`);
  }
  lines.push(`viewPreference:table`);

  const configBlock = `\`\`\`tlb\n${lines.join('\n')}\n\`\`\``;

  // 读取当前文件内容
  const content = await this.app.vault.read(this.file);

  // 移除旧的配置块
  const withoutOldConfig = content.replace(/```tlb\s*\n[\s\S]*?\n```[\s]*$/g, '');

  // 在文件末尾添加新配置块
  const newContent = `${withoutOldConfig.trimEnd()}\n\n${configBlock}\n`;

  await this.app.vault.modify(this.file, newContent);

  // 更新缓存
  const plugin = getPluginContext();
  const cacheManager = plugin?.cacheManager;
  if (cacheManager) {
    const config: TlbConfigBlock = {
      __meta__: { fileId: this.fileId, version },
      filterViews: this.filterViewState,
      columnWidths: this.columnWidthPrefs ?? {},
      viewPreference: 'table'
    };
    cacheManager.setCache(this.fileId, this.file.path, config);
  }
}

private generateFileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 备用方案
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
```

## 关键决策记录

### Q1: 元数据放在第一行还是最后一行？

**决策：第一行**

理由：
- 文件读取从头开始，第一行性能最优
- 无需扫描整个文件即可获取版本号
- 快速路径：读第一行 → 查缓存 → 渲染

### Q2: 配置项压缩成一行还是多行？

**决策：多行**

理由：
- 便于 Git diff（每个配置项独立变更）
- 便于手动编辑（如果需要）
- 高度增加有限（通常 3-5 行）

### Q3: fileId 如何生成？

**决策：UUID（方案 C）**

理由：
- 唯一性保证（跨设备不冲突）
- 文件重命名/移动后仍能匹配缓存
- 标准化，易于实现

### Q4: 是否保留插件设置作为备份？

**决策：是**

理由：
- 向后兼容旧版本
- 作为配置丢失时的备份
- 写入策略：**同时写入**文件、缓存、插件设置

### Q5: 如何处理配置块解析失败？

**策略：**
1. 元数据解析失败 → 回退到插件设置，自动迁移
2. 配置项解析失败 → 跳过该项，使用默认值
3. 不阻断表格渲染
4. 记录错误日志（不在 UI 显示，避免打扰用户）

### Q6: 多窗口/多设备编辑冲突？

**策略：**
1. 短期：最后写入胜出（Last Write Wins）
2. 中期：监听文件变化，检测外部修改（版本号变化），重新加载
3. 长期：考虑冲突检测和合并策略（如果需要）

## 开发任务拆分

- [ ] **阶段1：缓存系统基础**
  - [ ] 创建 `FileCacheManager` 类
  - [ ] 实现缓存读写（`load()`, `save()`, `getCache()`, `setCache()`）
  - [ ] 在插件中初始化缓存管理器
  - [ ] 实现 `generateFileId()` 方法（UUID）

- [ ] **阶段2：读取配置块（快速路径）**
  - [ ] 实现 `extractMetadata()` 方法（提取第一行）
  - [ ] 实现 `parseConfigBlock()` 方法（解析完整配置）
  - [ ] 实现 `loadConfig()` 方法（带缓存逻辑）
  - [ ] 修改 `render()` 方法，应用文件内配置
  - [ ] 测试：创建带配置块的测试文件

- [ ] **阶段3：写入配置块**
  - [ ] 实现 `saveConfigBlock()` 方法
  - [ ] 在 `persistFilterViews()` 中触发写入
  - [ ] 在 `handleColumnResize()` 中触发写入
  - [ ] 同步更新缓存
  - [ ] 测试：修改配置后检查文件和缓存

- [ ] **阶段4：迁移与兼容**
  - [ ] 实现 `migrateFromPluginSettings()` 方法
  - [ ] 首次打开时自动迁移
  - [ ] 确保向后兼容（同时写入插件设置）
  - [ ] 处理配置块解析错误
  - [ ] 测试：旧文件自动迁移

- [ ] **阶段5：文件监听与同步**
  - [ ] 监听文件修改事件
  - [ ] 检测版本号变化，重新加载配置
  - [ ] 处理多窗口同步
  - [ ] 测试：外部编辑文件后刷新

- [ ] **阶段6：测试与优化**
  - [ ] 性能测试：缓存命中率
  - [ ] 测试跨设备同步场景
  - [ ] 测试文件重命名场景
  - [ ] 清理过期缓存（可选）
  - [ ] 更新用户文档

## 成功标准

1. **单文件完整性**：
   - 文件包含所有配置信息（列配置 + 运行时配置）
   - 移动/分享文件时配置完整保留

2. **跨设备同步**：
   - 通过 Obsidian Sync 或其他同步工具，配置自动同步
   - 无需手动迁移插件设置

3. **向后兼容**：
   - 旧版本插件仍能正常工作
   - 新版本能识别旧格式并自动迁移

4. **数据安全**：
   - 配置块解析失败不影响表格渲染
   - 插件设置作为备份保留

## 参考

- 现有 `tlb` 列配置块：[TableView.ts:112-141](src/TableView.ts#L112-L141)
- 过滤视图数据结构：[filterView.ts](src/types/filterView.ts)
- 插件设置管理：[main.ts:814-834](src/main.ts#L814-L834)
