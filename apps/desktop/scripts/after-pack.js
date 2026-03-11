const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

// electron-builder Arch enum: 0=ia32, 1=x64, 2=armv7l, 3=arm64, 4=universal
const ARCH_NAME = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

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

  // Rebuild native modules for the target architecture.
  // prepare-gateway.sh compiled them for the CI runner's arch (e.g. arm64),
  // but the target may differ (e.g. x64). The gateway runs under Electron's
  // Node (process.execPath), so we must compile against Electron's headers.
  const arch = ARCH_NAME[context.arch] || 'x64'
  const electronVersion = context.packager.config.electronVersion
    || require(path.join(projectDir, 'node_modules', 'electron', 'package.json')).version
  const gatewayDir = path.join(resourcesDir, 'gateway')

  console.log(`[after-pack] Rebuilding native modules for ${context.electronPlatformName}-${arch} (Electron ${electronVersion})...`)
  // Use programmatic API — @electron/rebuild is a transitive dep of electron-builder
  const { rebuild } = require(require.resolve('@electron/rebuild', {
    paths: [projectDir, path.join(projectDir, 'node_modules')]
  }))
  await rebuild({
    buildPath: gatewayDir,
    electronVersion,
    arch,
    force: true,
  })

  // Verify native binary architecture (macOS only — `file` command)
  if (context.electronPlatformName === 'darwin') {
    const bsqlite = path.join(dest, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
    if (fs.existsSync(bsqlite)) {
      const fileInfo = execSync(`file "${bsqlite}"`).toString().trim()
      console.log(`[after-pack] Verify: ${fileInfo}`)
      const expected = arch === 'x64' ? 'x86_64' : 'arm64'
      if (!fileInfo.includes(expected)) {
        throw new Error(`[after-pack] Architecture mismatch! Expected ${expected} but got: ${fileInfo}`)
      }
    }
  }

  const size = execSync(`du -sh "${dest}"`).toString().split('\t')[0]
  console.log(`[after-pack] Done. node_modules size: ${size}`)
}
