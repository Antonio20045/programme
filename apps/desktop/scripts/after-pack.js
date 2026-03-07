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
  console.log(`[after-pack] Copying node_modules: ${src} -> ${dest}`)

  // Remove any leftover from extraResources
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true })
  }

  // Symlinks are already resolved by prepare-gateway.sh — plain copy is sufficient
  fs.cpSync(src, dest, { recursive: true })

  const size = execSync(`du -sh "${dest}"`).toString().split('\t')[0]
  console.log(`[after-pack] Done. node_modules size: ${size}`)
}
