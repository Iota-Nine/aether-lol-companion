import { fetchOpggRankedMeta, fetchOpggBuild } from '../server/opgg.ts'

const meta = await fetchOpggRankedMeta('euw')
console.log('patch', meta.patch, 'champs', meta.byId.size)
const garen = [...meta.byId.values()].find((c) => c.championId === 86)
console.log('garen ranked', garen)

const build = await fetchOpggBuild({
  championId: 86,
  championKey: 'Garen',
  position: 'TOP',
})
console.log(build)
