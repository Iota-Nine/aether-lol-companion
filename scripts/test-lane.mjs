import { fetchOpggLaneTop } from '../server/opgg.ts'

const lanes = ['top', 'jungle', 'mid', 'adc', 'support']
for (const lane of lanes) {
  const r = await fetchOpggLaneTop(lane, 7)
  console.log('\n==', lane, 'patch', r.patch)
  for (let i = 0; i < r.champs.length; i++) {
    const c = r.champs[i]
    console.log(
      `${i + 1}. id=${c.championId} WR=${c.winRate} PR=${c.pickRate} tier=${c.tier} rank=${c.tierRank}`,
    )
  }
}
