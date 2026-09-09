import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = path.join(root, 'package.json')
const cfgPath = path.join(root, 'electron', 'update-config.json')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))

const owner = String(cfg.owner || '')
const repo = String(cfg.repo || '')

if (!owner || owner.startsWith('TON_') || !repo || repo === 'TON_REPO') {
  console.error(`
[AETHER] Auto-update non configuré.

1. Édite electron/update-config.json :
   { "provider": "github", "owner": "tonPseudo", "repo": "aether-lol-companion" }

2. Crée le repo GitHub (public recommandé pour les updates)

3. Définis un token GitHub avec droits repo :
   setx GH_TOKEN "ghp_xxx"

4. Incrémente la version dans package.json (ex: 1.0.1)

5. Relance : npm run publish:app
`)
  process.exit(1)
}

if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  console.error('[AETHER] GH_TOKEN manquant. Crée un token GitHub (repo) puis: setx GH_TOKEN "ghp_xxx"')
  process.exit(1)
}

pkg.build = pkg.build || {}
pkg.build.publish = [
  {
    provider: 'github',
    owner,
    repo,
    private: Boolean(cfg.private),
    releaseType: 'release',
  },
]
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

console.log(`[AETHER] Publication v${pkg.version} → github.com/${owner}/${repo}`)

const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true })
if (build.status !== 0) process.exit(build.status || 1)

const publish = spawnSync(
  'npx',
  ['electron-builder', '--win', '--publish', 'always'],
  { cwd: root, stdio: 'inherit', shell: true, env: process.env },
)
process.exit(publish.status || 0)
