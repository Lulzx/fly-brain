// LIF connectome kernel (same model as src/lif.js), compiled to wasm32 + SIMD.
// All arrays live in one (shared) linear memory; JS lays them out and passes a Brain* header.
#include <stdint.h>
typedef struct {
  int32_t N, nslots, head, coba;
  float dt, vRest, vThresh, vReset, tRef, adaptInc, depU;
  float dE, dTr, dA, kRec, kM, dtS, eExc, eInh, cE, cI;
  uint32_t rng;
  float *v, *gE, *gI, *refr, *trace, *adapt, *res, *bias, *thr, *drive, *sign;
  uint32_t *spikeCount;
  const uint32_t *indptr, *indices; const float *weights;
  int32_t *ring, *ringCount;          // nslots x N fired lists (delay line)
  int32_t *driven; int32_t nDriven;   // neurons with drive > 0
  int32_t nFired;                     // spikes emitted in last step (list = ring slot written this step)
  int32_t lastSlot;
  float bgEvents;   // expected background synaptic events per step (N * rate * dt)
  float bgAmp;      // PSP amplitude of one background event (mV-equivalent, excitatory)
  float bgAcc;      // fractional accumulator
} Brain;

static inline uint32_t xs(uint32_t *s) { uint32_t x = *s; x ^= x << 13; x ^= x >> 17; x ^= x << 5; *s = x; return x; }

__attribute__((export_name("lif_step")))
int32_t lif_step(Brain *b) {
  const int32_t N = b->N;
  float *v = b->v, *gE = b->gE, *gI = b->gI, *refr = b->refr, *trace = b->trace, *adapt = b->adapt, *res = b->res, *bias = b->bias, *thr = b->thr, *drive = b->drive, *sign = b->sign;
  const uint32_t *indptr = b->indptr, *indices = b->indices; const float *W = b->weights; uint32_t *spikeCount = b->spikeCount;
  // 1. deliver spikes arriving now
  int32_t *arr = b->ring + (int64_t)b->head * N; int32_t na = b->ringCount[b->head];
  for (int32_t k = 0; k < na; k++) {
    int32_t pre = arr[k]; float s = sign[pre] * res[pre]; if (s == 0.f) continue;
    res[pre] -= b->depU * res[pre];
    uint32_t a = indptr[pre], e = indptr[pre + 1];
    if (s > 0) for (uint32_t j = a; j < e; j++) gE[indices[j]] += W[j] * s;
    else for (uint32_t j = a; j < e; j++) gI[indices[j]] += W[j] * s;
  }
  b->ringCount[b->head] = 0;
  int32_t slot = (b->head + b->nslots - 1) % b->nslots; int32_t *out = b->ring + (int64_t)slot * N; int32_t nf = 0;
  // 1b. background synaptic events onto random neurons (spontaneous release / unmodelled inputs)
  b->bgAcc += b->bgEvents; int32_t nbg = (int32_t)b->bgAcc; b->bgAcc -= nbg;
  for (int32_t k = 0; k < nbg; k++) { uint32_t i = xs(&b->rng) % (uint32_t)N; gE[i] += b->bgAmp; }
  // 2. Poisson-driven (sensory) neurons: forced spikes
  const float dtS = b->dtS, tRef = b->tRef, vReset = b->vReset, adaptInc = b->adaptInc;
  for (int32_t k = 0; k < b->nDriven; k++) { int32_t i = b->driven[k]; if (refr[i] > 0) continue;
    float p = drive[i] * dtS; if ((xs(&b->rng) >> 8) * (1.0f / 16777216.0f) < p) { v[i] = vReset; refr[i] = tRef + b->dt; out[nf++] = i; spikeCount[i]++; trace[i] = 1.f; adapt[i] += adaptInc; } }
  // 3. membrane update for every neuron (vectorisable)
  const float vRest = b->vRest, vThresh = b->vThresh, kM = b->kM, dE = b->dE, dTr = b->dTr, dA = b->dA, kRec = b->kRec, dt = b->dt;
  if (b->coba) {
    const float eExc = b->eExc, eInh = b->eInh, cE = b->cE, cI = b->cI;
    for (int32_t i = 0; i < N; i++) {
      float vi = v[i], r = refr[i];
      float dv = (vRest - vi + gE[i] * (eExc - vi) * cE + gI[i] * (vi - eInh) * cI + bias[i]) * kM;
      vi = r > 0 ? vReset : vi + dv;
      refr[i] = r > 0 ? r - dt : r;
      v[i] = vi; gE[i] *= dE; gI[i] *= dE; trace[i] *= dTr; adapt[i] *= dA; res[i] += (1.f - res[i]) * kRec;
    }
  } else {
    for (int32_t i = 0; i < N; i++) {
      float vi = v[i], r = refr[i];
      float dv = (vRest - vi + gE[i] + gI[i] + bias[i]) * kM;
      vi = r > 0 ? vReset : vi + dv;
      refr[i] = r > 0 ? r - dt : r;
      v[i] = vi; gE[i] *= dE; gI[i] *= dE; trace[i] *= dTr; adapt[i] *= dA; res[i] += (1.f - res[i]) * kRec;
    }
  }
  // 4. threshold crossings (scalar, sparse)
  for (int32_t i = 0; i < N; i++) {
    if (v[i] >= vThresh + adapt[i] + thr[i] && refr[i] <= 0) { v[i] = vReset; refr[i] = tRef; out[nf++] = i; spikeCount[i]++; trace[i] = 1.f; adapt[i] += adaptInc; }
  }
  b->ringCount[slot] = nf; b->lastSlot = slot; b->nFired = nf;
  b->head = (b->head + 1) % b->nslots;
  return nf;
}
