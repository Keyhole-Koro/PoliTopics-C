const path = require('path');
const fse = require('fs-extra');

const projectRoot = path.join(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const nodeModulesSrc = path.join(projectRoot, 'node_modules');
const nodeModulesDest = path.join(distDir, 'node_modules');
const filesToCopy = ['package.json', 'package-lock.json', '.env']; // Add/remove as needed

async function copyDependencies() {
  try {
    // Copy node_modules
    await fse.copy(nodeModulesSrc, nodeModulesDest);
    console.log('✅ node_modules copied to dist/node_modules');

    // Copy package.json and package-lock.json
    for (const file of filesToCopy) {
      const src = path.join(projectRoot, file);
      const dest = path.join(distDir, file);
      if (await fse.pathExists(src)) {
        await fse.copy(src, dest);
        console.log(`✅ ${file} copied to dist/`);
      } else {
        console.warn(`⚠️  ${file} not found, skipping.`);
      }
    }

  } catch (err) {
    console.error('❌ Error copying files:', err);
  }
}

copyDependencies();
