import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// 目标插件目录
const PLUGIN_DIR = 'D:\\X\\Dropbox\\obs\\.obsidian\\plugins\\tile-line-base';

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

// 3. 重启 Obsidian
console.log('\n🔄 正在重启 Obsidian...');
try {
  // 关闭 Obsidian
  try {
    execSync('taskkill /F /IM Obsidian.exe', { stdio: 'ignore' });
    console.log('  ✓ 已关闭 Obsidian');
  } catch (e) {
    console.log('  ℹ Obsidian 未运行');
  }

  // 等待一下
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 启动 Obsidian
  // 注意：你可能需要修改这个路径为你的 Obsidian 安装路径
  const obsidianPath = 'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Obsidian\\Obsidian.exe';

  if (fs.existsSync(obsidianPath)) {
    execSync(`start "" "${obsidianPath}"`, { stdio: 'ignore' });
    console.log('  ✓ 已启动 Obsidian');
  } else {
    console.log('  ⚠ 找不到 Obsidian.exe，请手动启动');
    console.log(`  预期路径: ${obsidianPath}`);
  }

} catch (error) {
  console.log('  ⚠ 重启失败，请手动重启 Obsidian');
  console.log('  错误信息:', error.message);
}

console.log('\n🎉 部署完成！');
