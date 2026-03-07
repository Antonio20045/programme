const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

exports.default = async function (context) {
  const projectDir = context.packager.projectDir
  const src = path.join(projectDir, 'gateway-bundle', 'node_modules')
  if (!fs.existsSync(src)) {
    throw new Error('[after-pack] gateway-bundle/node_modules not found — run prepare-gateway.sh first')
  }

  // Determine Resources dir based on platform
  let resourcesDir
  if (context.electronPlatformName === 'darwin') {
    resourcesDir = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources'
    )
  } else {
    resourcesDir = path.join(context.appOutDir, 'resources')
  }

  const dest = path.join(resourcesDir, 'gateway', 'node_modules')
  console.log(`[after-pack] Copying node_modules (dereferencing symlinks): ${src} -> ${dest}`)

  // Remove any symlink-based copy from extraResources
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true })
  }

  // rsync -rL dereferences pnpm's nested symlinks (macOS/Linux)
  // On Windows, pnpm uses junctions — fs.cpSync with dereference handles those
  if (process.platform === 'win32') {
    fs.cpSync(src, dest, { recursive: true, dereference: true })
  } else {
    execSync(`rsync -rL "${src}/" "${dest}/"`, { stdio: 'inherit' })
  }

  const size = execSync(`du -sh "${dest}"`).toString().split('\t')[0]
  console.log(`[after-pack] Done. node_modules size: ${size}`)
}
