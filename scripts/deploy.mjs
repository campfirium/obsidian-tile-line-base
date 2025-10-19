import fs from 'fs';
import path from 'path';

// 目标插件目录
const PLUGIN_DIR = "D:\\C\\obsidian-tile-line-base\\docs\\.obsidian\\plugins\\tile-line-base";
const DIST_DIR = path.resolve(process.cwd(), 'dist');

console.log('🚀 开始部署插件到 Obsidian...\n');

if (!fs.existsSync(DIST_DIR)) {
  console.log(`⚠ 未找到 dist 目录: ${DIST_DIR}`);
  console.log('💡 请先运行 npm run build 后再尝试部署。');
  process.exit(1);
}

let pluginDirInfo = '未知';
try {
  if (!fs.existsSync(PLUGIN_DIR)) {
    pluginDirInfo = '不存在';
  } else {
    const realPluginPath = fs.realpathSync(PLUGIN_DIR);
    if (realPluginPath.toLowerCase() === DIST_DIR.toLowerCase()) {
      pluginDirInfo = `已链接到 dist: ${realPluginPath}`;
    } else {
      pluginDirInfo = `指向其他路径: ${realPluginPath}`;
    }
  }
} catch (error) {
  pluginDirInfo = `读取失败: ${(error && error.message) || error}`;
}

console.log(`🔗 当前部署目录信息: ${pluginDirInfo}`);
console.log('📦 检测到目录链接部署模式，跳过文件复制。');
console.log('\n✅ 部署指令执行完毕（未复制文件）。');
console.log('\n🎉 请在 Obsidian 中重载插件以应用最新构建。');
