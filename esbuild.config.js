const esbuild = require('esbuild');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');

// 生产环境：打包成单个文件
// 开发/测试环境：编译所有文件（包括测试文件）
const config = isProduction ? {
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: './out/extension.js',
  external: ['vscode'],
  target: 'es2020',
  platform: 'node',
  sourcemap: false,
  minify: true,
  format: 'cjs',
  metafile: true,
} : {
  entryPoints: ['./src/**/*.ts'],
  bundle: false,
  outdir: './out',
  outbase: './src',
  target: 'es2020',
  platform: 'node',
  sourcemap: true,
  minify: false,
  format: 'cjs',
};

async function build() {
  try {
    // 生产模式下清理输出目录
    if (isProduction && fs.existsSync('./out')) {
      fs.rmSync('./out', { recursive: true, force: true });
      console.log('Cleaned output directory');
    }
    
    if (isWatch) {
      const ctx = await esbuild.context(config);
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      const result = await esbuild.build(config);
      console.log('Build completed successfully!');
      
      // 分析打包大小
      if (result.metafile) {
        const outputs = result.metafile.outputs;
        const inputs = result.metafile.inputs;
        
        console.log('\n📦 Bundle Analysis:');
        
        // 计算各个输入文件的大小贡献
        const inputSizes = Object.entries(inputs)
          .map(([path, info]) => ({ path, bytes: info.bytes }))
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 10);
        
        console.log('\nTop 10 largest inputs:');
        inputSizes.forEach(({ path, bytes }) => {
          const kb = (bytes / 1024).toFixed(2);
          console.log(`  ${kb.padStart(8)} KB  ${path}`);
        });
        
        // 输出文件大小
        Object.entries(outputs).forEach(([path, info]) => {
          const kb = (info.bytes / 1024).toFixed(2);
          console.log(`\nOutput: ${kb} KB - ${path}`);
        });
      }
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
