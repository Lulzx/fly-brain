// Is src/lifdiff.js the shipped model under VISUAL drive?
//
// scripts/lifdiff_equiv.mjs answers the same question for the sugar assay and, once src/diffsetup.js
// supplies the octopamine tone and the rest of makeBrain's structure, the answer there is yes: MN9,
// GNG232 and DNge080 all land within sampling error. This script asks it for the loom, and the answer
// is no, in the opposite direction from what a missing-structure bug would predict.
//
// The two are given the *same* drive sequence. The shipped brain runs the benchmark's loom, the drive
// rate it computes for all 62,157 coupled neurons is recorded at every optic-lobe epoch, and that
// recording is then replayed into LIFDiff. So the optic lobe and the coupling are held identical by
// construction -- scripts/vis_equiv.mjs already shows they are bit-identical anyway -- and anything
// left is the spiking CNS.
//
//   node --max-old-space-size=14000 scripts/lifdiff_loom_equiv.mjs
//
// What it finds: DNp01 fires 2 spikes per neuron in the shipped kernel and 27 in LIFDiff, with 1.7x the
// total network activity and LC4 six times as active. The difference is a sparse-drive regime rather
// than a chain: the sugar assay drives a few hundred neurons hard and agrees, while this drives 62,157
// neurons at a mean of 1.7 Hz and does not. Whatever is left is something that only shows up when most
// of the network is receiving a little input, which is the regime every visual assay is in.
import fs from 'node:fs';
import { loadAll } from './lib_node.mjs';
import { parseFlyVis, FlyVis, flyvisBytes } from '../src/flyvis.js';
import { LIFWasm, writeGraph, graphBytes, brainBytes } from '../src/lifwasm.js';
import { LIFDiff } from '../src/lifdiff.js';
import { diffOptions } from '../src/diffsetup.js';
import { brainScales, applyClassPhysiology, modulatorySign, typeGains, BRAIN_DEFAULTS, PATHWAY_TYPES } from '../src/brainmodel.js';
import { Neuromod } from '../src/sim/neuromod.js';
const R='';
const D=loadAll(); const DATA={...D, superclass:D.sc};
const FVB=fs.readFileSync(R+'public/vision/flyvis.bin');
const FVM=parseFlyVis(FVB.buffer.slice(FVB.byteOffset,FVB.byteOffset+FVB.byteLength),
  JSON.parse(fs.readFileSync(R+'public/vision/flyvis.json')),JSON.parse(fs.readFileSync(R+'public/vision/flyvis_inputs.json')));
const FVMAP=JSON.parse(fs.readFileSync(R+'public/vision/flyvis_map.json'));
const SIZE=new Float32Array(fs.readFileSync(R+'public/data/neuron_size.bin').buffer.slice(0));
const SIGN=new Float32Array(fs.readFileSync(R+'public/data/ntsign.bin').buffer.slice(0));
const BASE=(()=>{const o=JSON.parse(fs.readFileSync(R+'public/data/brain_params.json'));for(const k of Object.keys(o))if(k[0]==='_')delete o[k];return o;})();
const o={...BRAIN_DEFAULTS,...BASE};
const MEMB=graphBytes(D.N,D.E)+brainBytes(D.N,20)+flyvisBytes(FVM.N,FVM.E)+FVM.N*4*8+(8<<20);
const PAGES=Math.ceil(MEMB/65536);
const MEM=new WebAssembly.Memory({initial:PAGES,maximum:PAGES,shared:true});
const INST=(await WebAssembly.instantiate(fs.readFileSync(R+'public/lif.wasm'),{env:{memory:MEM}})).instance;
// ---- shipped brain
const {inScale, sensoryMask}=brainScales(DATA,SIZE,o);
for(const sd of ['L','R']) for(const [i] of FVMAP.eyes[sd].pairs) sensoryMask[i]=1;
const GRAPH=writeGraph(MEM,1024,{...DATA,weights:DATA.weights},{...o},inScale,sensoryMask,modulatorySign(DATA,SIGN,o),typeGains(DATA,o));
const net=new LIFWasm({instance:INST,memory:MEM,graph:GRAPH,base:(GRAPH.end+4095)&~4095,N:D.N,params:o,seed:1});
applyClassPhysiology(net,DATA,o);
if(o.neuromod) new Neuromod(DATA,net,{minSyn:o.minSyn}).modulate();
// ---- eyes
let base=(net.end+65535)&~65535;
const e0=new FlyVis(INST,MEM,base,FVM), e1=new FlyVis(INST,MEM,(e0.end+4095)&~4095,{...FVM,shared:e0.sharedParts,bias:e0.bias});
const grey=new Float32Array(721).fill(0.5);
for(const e of [e0,e1]){e.setInput(grey);for(let k=0;k<150;k++)e.step();}
const vRest=e0.v.slice(0); const eyes=[e0,e1];
const COLDIRS=['L','R'].map(sd=>FVMAP.eyes[sd].dirs);
function lumLoom(eye,t){const c=[Math.cos(0.17)*Math.cos(0.7),Math.cos(0.17)*Math.sin(0.7),Math.sin(0.17)];
  const rad=(5+70*Math.max(0,Math.min(1,t/0.4))**2)*Math.PI/180;
  return Float32Array.from(COLDIRS[eye],d=>Math.acos(Math.min(1,d[0]*c[0]+d[1]*c[1]+d[2]*c[2]))<rad?0.05:0.5);}
const FVPAIRS=['L','R'].map(sd=>({n:Int32Array.from(FVMAP.eyes[sd].pairs,p=>p[0]),node:Int32Array.from(FVMAP.eyes[sd].pairs,p=>p[1])}));
const GF=D.byType('DNp01');
const ORN=D.bodymap.sensors.filter(s=>s.kind==='odor').flatMap(s=>s.idx);
net.setDrive(ORN,6);
// record the drive sequence per epoch while running the shipped brain
const EPOCHS=30, drives=[];
const prev=new Uint32Array(D.N);
for(let s=0;s<1200;s++){
  if(s%40===0){const t=(s-400)/2000;
    for(let e=0;e<2;e++){eyes[e].setInput(t<0?grey:lumLoom(e,t));eyes[e].step();}
    const rec=new Float32Array(FVPAIRS[0].n.length+FVPAIRS[1].n.length); let w=0;
    for(let e=0;e<2;e++){const v=eyes[e].v,P=FVPAIRS[e];
      for(let k=0;k<P.n.length;k++){const a=v[P.node[k]]-vRest[P.node[k]];const r=a>0.02?Math.min(200,250*a):0;net.setDriveOne(P.n[k],r);rec[w++]=r;}}
    drives.push(rec);}
  if(s===400) prev.set(net.spikeCount);
  net.step();
}
let gfW=0; for(const i of GF) gfW+=net.spikeCount[i]-prev[i];
console.log(`shipped LIFWasm:  DNp01 ${(gfW/GF.length).toFixed(3)} spikes/neuron after onset (GF n=${GF.length})`);
// ---- same drive into LIFDiff
const SETUP=diffOptions(D,SIZE,o,SIGN);
const sm2=Uint8Array.from(SETUP.sensoryMask); for(const sd of ['L','R']) for(const [i] of FVMAP.eyes[sd].pairs) sm2[i]=1;
const ALLN=[...FVPAIRS[0].n,...FVPAIRS[1].n];
// driveEpoch must match the 40-step cadence the drive was recorded on -- without it the epochs
// apply on consecutive steps, drives[30..] is undefined, and the last recorded epoch (near-peak
// loom) is held for the rest of the run. That replay bug, not the model, was the "mismatch".
const nd=new LIFDiff(D,{...o,...SETUP,sensoryMask:sm2,soft:false,driveEpoch:40});
nd.setDrive(ORN,6);
const tape=nd.forward(1200,{seed:1,record:true,onEpoch:(e)=>{
  const rec=drives[e]; if(!rec) return; for(let k=0;k<ALLN.length;k++) nd.setDriveOne(ALLN[k],rec[k]);}});
const post=tape.spikes.slice(400).reduce((a,f)=>{for(const i of f.idx)a[i]++;return a;},new Float32Array(D.N));
let gfD=0; for(const i of GF) gfD+=post[i];
console.log(`LIFDiff, same drive: DNp01 ${(gfD/GF.length).toFixed(3)} spikes/neuron after onset`);
// how much drive actually arrives, and how much the two networks spike overall
let tot=0,mx=0; for(const rec of drives){for(const r of rec){tot+=r; if(r>mx)mx=r;}}
console.log(`drive: mean ${(tot/(drives.length*ALLN.length)).toFixed(2)} Hz, max ${mx.toFixed(0)} Hz over ${drives.length} epochs`);
let sW=0,sD=0; for(let i=0;i<D.N;i++){sW+=net.spikeCount[i];sD+=nd.spikeCount[i];}
console.log(`total spikes: wasm ${sW}  lifdiff ${sD}  ratio ${(sD/sW).toFixed(3)}`);
// what feeds DNp01: LC4/LPLC2 activity in both
for(const t of ['LC4','LPLC2','DNp02','DNp04']){const ix=D.byType(t); if(!ix.length)continue;
  let a=0,b=0; for(const i of ix){a+=net.spikeCount[i];b+=nd.spikeCount[i];}
  console.log(`  ${t.padEnd(7)} n=${String(ix.length).padStart(4)}  wasm ${(a/ix.length).toFixed(2)}  lifdiff ${(b/ix.length).toFixed(2)}`);}
