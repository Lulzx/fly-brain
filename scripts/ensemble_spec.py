#!/usr/bin/env python3
"""Ensemble-spec generator: the middle pass of the connectome compiler.

Detected operators (operators.json, from the BioISA layer) declare a substrate:
which cell types implement the computation. This pass turns each executable
operator into a declarative ensemble spec consumed by run_ensemble.mjs:

    operator + measured wiring -> {populations, uncertain gain axes, probes,
                                   perturbations, hypothesis classes, provenance}

The gain axes are the parameters the wiring does NOT fix (per-edge-class
scalar gains and tonic biases); the perturbations are the operator's
load-bearing elements (each substrate population silenced; each measured
edge class ablated). That is the difference between a viewer and a compiler:
the analysis is generated from the detection, not written per circuit.

Writes public/data/ensemble_specs.json.
"""
import json
import numpy as np

ops = json.load(open('public/data/operators.json'))
algo = json.load(open('public/data/algo_structures.json'))


def pen_types():
    return ['PEN_a(PEN1)', 'PEN_b(PEN2)']


# The spec encodes what each operator's signature implies about the ensemble:
# which edge classes are free gains, which populations are load-bearing,
# which probes expose the semantics.
SPECS = {}

# --- ring_attractor: cyclic state estimator ---
# substrate: EPG bump, Delta7 surround, PEG copy, PEN shifter.
# Free parameters: per-edge-class gains the connectome measures only up to
# scale, plus tonic excitability. Perturbations: each load-bearing population.
SPECS['ring_attractor'] = {
    'geometry': 'ring',
    'operator': 'ring_attractor',
    'populations': {
        'bump': 'EPG', 'surround': 'Delta7', 'copy': 'PEG',
        'shifter': pen_types(),
    },
    'roles': {'bump': 'bump', 'shifter': 'shifter'},
    'edge_params': [
        {'pre': 'EPG', 'post': 'EPG', 'param': 'epgRecur',
         'why': 'EPG->EPG recurrence gain is not fixed by synapse counts'},
        {'pre': 'Delta7', 'post': 'EPG', 'param': 'd7Gain',
         'why': 'Delta7 inhibition is glutamatergic via GluClA; effective sign/strength uncertain'},
        {'pre': pen_types(), 'post': 'EPG', 'param': 'penGain',
         'why': 'PEN->EPG shifted feedback gain'},
    ],
    'tonics': [{'pop': 'bump', 'param': 'epgTonic',
                'why': 'tonic EPG excitability (resting drive) is unknown'}],
    'grid': {'epgRecur': [1, 3, 4, 6], 'd7Gain': [0.5, 1.0, 1.3],
             'epgTonic': [0, 3, 5, 7], 'penGain': [1]},
    'perturbations': [
        {'name': 'd7_silence', 'silence': 'surround',
         'why': 'top-ranked discriminator in the LIF ensemble'},
        {'name': 'peg_lesion', 'silence': 'copy',
         'why': 'tests whether the PEG copy pathway is load-bearing'},
    ],
    'mech_perturbation': 'd7_silence',
    'hypotheses': ['attractor_free', 'attractor_tonic', 'filter', 'frozen', 'silent'],
}

# --- phasor_vector_shift: vector rotation by wiring offset ---
# substrate: PFNd/PFNv sources, hDeltaB target. Structure predicts -3/+2
# column offsets; the ensemble asks whether dynamics realises them and
# which element (projection geometry, PFN recurrence, hDeltaB recurrence,
# hDeltaB->PFN feedback) is load-bearing.
SPECS['phasor_vector_shift'] = {
    'geometry': 'linear',
    'operator': 'phasor_vector_shift',
    'populations': {
        'PFNd': 'PFNd', 'PFNv': 'PFNv', 'target': 'hDeltaB',
    },
    'roles': {'sources': ['PFNd', 'PFNv'], 'target': 'target'},
    'structural_offsets': {'PFNd': -3, 'PFNv': 2},   # fb_columnar_offsets peaks
    'drive_column': 6,
    'edge_params': [
        {'pre': 'PFNd', 'post': 'hDeltaB', 'param': 'pfndGain'},
        {'pre': 'PFNv', 'post': 'hDeltaB', 'param': 'pfnvGain'},
        {'pre': 'hDeltaB', 'post': 'hDeltaB', 'param': 'hdRecur'},
        {'pre': 'PFNd', 'post': 'PFNd', 'param': 'pfnRecur'},
        {'pre': 'hDeltaB', 'post': ['PFNd', 'PFNv'], 'param': 'hd2pfn'},
    ],
    'tonics': [{'pop': 'target', 'param': 'hdTonic'}],
    'grid': {'pfndGain': [0.5, 1, 2], 'pfnvGain': [0.5, 1, 2],
             'hdRecur': [0, 0.5, 1, 2], 'hdTonic': [0, 4],
             'pfnRecur': [1], 'hd2pfn': [1]},
    'perturbations': [
        {'name': 'hd_recur_off', 'param': 'hdRecur', 'set': 0},
        {'name': 'pfn_recur_off', 'param': 'pfnRecur', 'set': 0},
        {'name': 'hd2pfn_off', 'param': 'hd2pfn', 'set': 0},
        {'name': 'pfnv_silenced', 'silence': 'PFNv'},
    ],
    'hypotheses': ['wired_shift', 'passthrough', 'distorted', 'silent'],
}

# --- sparse_associative_memory: mushroom-body random projection ---
# substrate: KC input layer (~4k cells), APL feedback inhibition, MBON readout,
# DAN teaching. Observable: do overlapping input patterns ("odors") produce
# output vectors separated more than the inputs overlap? APL gain controls
# KC sparsity -> separability. Perturbations probe which element carries it.
SPECS['sparse_associative_memory'] = {
    'geometry': 'memory',
    'operator': 'sparse_associative_memory',
    'populations': {
        'kc': 'KC*', 'apl': 'APL*', 'mbon': 'MBON*',
        'dan': ['PPL*', 'PAM*'],
        # the odour has to arrive upstream of the expansion, or the layer's sparseness is the
        # stimulus rather than a response; 'pool:kc' is every external cell with >=3 synapses onto
        # at least two Kenyon cells, which the runner reads off the graph
        'pn': 'pool:kc',
    },
    'roles': {'input': 'kc', 'output': 'mbon', 'control': 'apl', 'drive': 'pn'},
    'odor_size': 80, 'odor_overlap': 0.5, 'drive_rate': 150,
    'edge_params': [
        {'pre': 'KC*', 'post': 'MBON*', 'param': 'kc2mb',
         'why': 'KC->MBON readout gain (44k edges; plastic in vivo)'},
        {'pre': 'APL*', 'post': 'KC*', 'param': 'aplGain',
         'why': 'APL feedback inhibition sets KC sparsity'},
        {'pre': 'MBON*', 'post': 'MBON*', 'param': 'mbRecur',
         'why': 'MBON->MBON recurrence (936 edges)'},
    ],
    'tonics': [{'pop': 'mbon', 'param': 'mbonTonic'}],
    'grid': {'kc2mb': [0.5, 1, 2], 'aplGain': [0.5, 1, 2],
             'mbonTonic': [0, 4], 'mbRecur': [1]},
    'perturbations': [
        {'name': 'apl_silence', 'silence': 'apl',
         'why': 'does separation survive without feedback inhibition?'},
        {'name': 'mb_recur_off', 'param': 'mbRecur', 'set': 0},
    ],
    'hypotheses': ['gain_controlled', 'linear_passthrough', 'collapsed', 'silent'],
}

# attach provenance: which evidence items justified the operator detection
for name, spec in SPECS.items():
    o = next((x for x in ops if x['name'] == name), None)
    spec['provenance'] = {
        'signature': o['signature'] if o else None,
        'evidence': o['evidence'] if o else [],
        'topology_folded': o['topology_folded'] if o else None,
    }

with open('public/data/ensemble_specs.json', 'w') as f:
    json.dump(SPECS, f, indent=1)
print(json.dumps({k: {'geometry': v['geometry'], 'grid_axes': list(v['grid']),
                      'n_perturbations': len(v['perturbations'])}
                  for k, v in SPECS.items()}, indent=1))
