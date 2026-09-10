# 10. Senses

File: `src/sim/senses.js`. Rates are recomputed every millisecond and set as Poisson drive.

| Sense | Stimulus | Encoding |
|---|---|---|
| Olfaction | Gaussian plumes, optional wind shift, sampled at each antenna | 6 Hz spontaneous plus up to 150 Hz, saturating in concentration |
| Labellar taste | Extended labellum within 0.65 mm of a food or bitter patch | Up to 180 Hz, gain set by hunger |
| Taste pegs | Labellum on food with proboscis extended | Up to 150 Hz |
| Leg taste | Claw touching a patch | Up to 150 Hz; pheromone near other flies |
| Tarsal touch | Contact onset and offset | 180 Hz burst decaying in 15 ms, tarsal quarter of bristles; 85% suppressed while stepping |
| Obstacle touch | Antenna tip or front claw at a wall, block or fly | Johnston's organ 120 Hz and femur/tibia bristles of the front leg 150 Hz, per side |
| Proprioception | Tibia and coxa angles, tarsal load | Gaussian population codes; load-proportional |
| Body bristles | Body contact with walls, obstacles, flies | 150 Hz per side, checked every 10 ms |
| Halteres | Angular velocity | Proportional above threshold |
| Johnston's organ | Air speed relative to the fly | Up to 150 Hz |
| Heat | Floor heat at each antenna | Up to 200 Hz per side |

## Odorants
| Odour | Glomeruli |
|---|---|
| Vinegar | DM1, DM4, VA2, DP1m, DM2, VM2, DL1 |
| Banana | DM1, DM3, VM2, DM2, VA2 |
| CO₂ | V |
| Geosmin | DA2 |
| Pheromone | DA1, VA1v, VA1d |

## Design notes
- Tactile bristles are rapidly adapting. Constant contact encoding drove the walking neurons and kept the
  fly from stopping on food.
- **Reafference.** Even as bursts, every footfall drove the forward and steering DNs. Walking became
  self-sustaining at full speed with constant turning. Insects inhibit afferents presynaptically during
  self-generated steps, so footfall bursts are scaled by 1 − 0.85 × stepping amplitude.
- Obstacle touch is geometric: the clearance from the antenna tip, 0.2 mm ahead of each antenna, or from the
  front claw to the nearest wall, block or fly at that height. Legs pass through walls
  ([Body](08-body-physics.md)), so without it the head is the first thing to meet a wall.
- Vision is described in [Vision](11-vision.md).
