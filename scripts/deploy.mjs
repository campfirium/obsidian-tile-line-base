import fs from 'fs';
import path from 'path';

// 目标插件目录
const PLUGIN_DIR = "D:\\C\\obsidian-tile-line-base\\docs\\.obsidian\\plugins\\tile-line-base";

// 需要复制的文件
const FILES_TO_COPY = [
  'main.js',
  'manifest.json',
  'styles.css'
];

console.log('🚀 开始部署插件到 Obsidian...\n');

// 1. 确保目标目录存在
if (!fs.existsSync(PLUGIN_DIR)) {
  console.log(`📁 创建插件目录: ${PLUGIN_DIR}`);
  fs.mkdirSync(PLUGIN_DIR, { recursive: true });
}

// 2. 复制文件
console.log('📦 复制文件...');
for (const file of FILES_TO_COPY) {
  const sourcePath = path.join(process.cwd(), file);
  const targetPath = path.join(PLUGIN_DIR, file);

  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`  ✓ ${file}`);
  } else {
    console.log(`  ⚠ ${file} 不存在，跳过`);
  }
}

console.log('\n✅ 文件复制完成！');

console.log('\n🎉 部署完成！请使用 Ctrl+R 在 Obsidian 中重载插件。');
