#!/usr/bin/env node
// Cut a KayKit Adventurers character down to the animation clips the board plays (lib/agents3d.src.mjs).
// The source pack is not in this repo (CC0, github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0).
//
//   npm i --no-save @gltf-transform/core @gltf-transform/functions
//   node scripts/prune-figures.mjs <pack>/Characters/gltf/Mage.glb public/board/agents/mage.glb
//   node scripts/prune-figures.mjs <pack>/Characters/gltf/Rogue_Hooded.glb public/board/agents/rogue.glb
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';

const KEEP = [
  'Idle', 'Cheer', 'Death_A', 'Lie_Idle', '2H_Melee_Idle', 'Blocking',
  'Sit_Floor_Down', 'Sit_Floor_Idle', 'Sit_Floor_StandUp',
  'Hit_A', 'Dodge_Backward', 'Jump_Full_Short',
  'Interact', 'Use_Item', 'PickUp', 'Throw', 'Running_A', 'Walking_A',
  'Spellcasting', 'Spellcast_Shoot', '1H_Ranged_Aiming', '1H_Ranged_Shoot',
  'Dualwield_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Slice', '2H_Ranged_Aiming', '2H_Ranged_Shoot',
];
const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('Usage: prune-figures <source.glb> <out.glb>'); process.exit(1); }
const io = new NodeIO();
const doc = await io.read(src);
for (const a of doc.getRoot().listAnimations()) if (!KEEP.includes(a.getName())) a.dispose();
await doc.transform(prune(), dedup());
await io.write(out, doc);
const names = doc.getRoot().listAnimations().map((a) => a.getName());
console.log(`${out}: ${names.length} clips`, KEEP.filter((k) => !names.includes(k)).length ? `missing ${KEEP.filter((k) => !names.includes(k))}` : '');
