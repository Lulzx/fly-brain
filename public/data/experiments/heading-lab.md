# heading-lab

**Question:** Which dynamical model does the heading-circuit wiring actually support?

**Operators:** epg.recurrence, d7.kernel, epg.tonic, pen.push

**Split rule:** `persistence.concentration < 0.5 * baseline.persistence.concentration`

Ensemble: 48 members over epgRecur, d7Gain, epgTonic, penGain (seed 20260704)

## Pre-registered observables

| observable | site | measure | value |
|---|---|---|---|
| persistence | circuit | bumpPersistence | — |
| kernel | circuit | d7Kernel | — |
| rotL | circuit | penRotation:L | — |
| rotR | circuit | penRotation:R | — |

## Ranked perturbations

| experiment | separation |
|---|---|
| obs:kernel | 1 |
| obs:persistence | 0.423 |
| peg_lesion | 0.337 |
| obs:rotR | 0.311 |
| d7_silence | 0.254 |
| obs:rotL | 0.191 |

## Members

| member | params | baseline | kills |
|---|---|---|---|
| 0 | {"epgRecur":1,"d7Gain":0.5,"epgTonic":0,"penGain":1} | persistence={"concentration":0,"seeded":0.99,"total_rate":0,"width_wedges":0} kernel={"n_d7":30,"contrast":1.71,"r2":0.601,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 1 | {"epgRecur":1,"d7Gain":0.5,"epgTonic":3,"penGain":1} | persistence={"concentration":0,"seeded":0.978,"total_rate":0,"width_wedges":0} kernel={"n_d7":40,"contrast":1.758,"r2":0.518,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 2 | {"epgRecur":1,"d7Gain":0.5,"epgTonic":5,"penGain":1} | persistence={"concentration":0,"seeded":0.967,"total_rate":0,"width_wedges":0} kernel={"n_d7":33,"contrast":1.719,"r2":0.645,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 3 | {"epgRecur":1,"d7Gain":0.5,"epgTonic":7,"penGain":1} | persistence={"concentration":0,"seeded":0.859,"total_rate":0,"width_wedges":0} kernel={"n_d7":35,"contrast":1.739,"r2":0.585,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 4 | {"epgRecur":1,"d7Gain":1,"epgTonic":0,"penGain":1} | persistence={"concentration":0,"seeded":0.991,"total_rate":0,"width_wedges":0} kernel={"n_d7":37,"contrast":1.77,"r2":0.565,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 5 | {"epgRecur":1,"d7Gain":1,"epgTonic":3,"penGain":1} | persistence={"concentration":0,"seeded":0.979,"total_rate":0,"width_wedges":0} kernel={"n_d7":41,"contrast":1.728,"r2":0.567,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 6 | {"epgRecur":1,"d7Gain":1,"epgTonic":5,"penGain":1} | persistence={"concentration":0,"seeded":0.97,"total_rate":0,"width_wedges":0} kernel={"n_d7":33,"contrast":1.741,"r2":0.572,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 7 | {"epgRecur":1,"d7Gain":1,"epgTonic":7,"penGain":1} | persistence={"concentration":0.933,"seeded":0.627,"total_rate":0.5,"width_wedges":0} kernel={"n_d7":38,"contrast":1.622,"r2":0.65,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | d7_silence |
| 8 | {"epgRecur":1,"d7Gain":1.3,"epgTonic":0,"penGain":1} | persistence={"concentration":0,"seeded":0.992,"total_rate":0,"width_wedges":0} kernel={"n_d7":40,"contrast":1.774,"r2":0.54,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 9 | {"epgRecur":1,"d7Gain":1.3,"epgTonic":3,"penGain":1} | persistence={"concentration":0,"seeded":0.977,"total_rate":0,"width_wedges":0} kernel={"n_d7":34,"contrast":1.766,"r2":0.545,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 10 | {"epgRecur":1,"d7Gain":1.3,"epgTonic":5,"penGain":1} | persistence={"concentration":0,"seeded":0.968,"total_rate":0,"width_wedges":0} kernel={"n_d7":38,"contrast":1.745,"r2":0.586,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 11 | {"epgRecur":1,"d7Gain":1.3,"epgTonic":7,"penGain":1} | persistence={"concentration":0,"seeded":0.575,"total_rate":0,"width_wedges":0} kernel={"n_d7":30,"contrast":1.765,"r2":0.586,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 12 | {"epgRecur":3,"d7Gain":0.5,"epgTonic":0,"penGain":1} | persistence={"concentration":0,"seeded":0.972,"total_rate":0,"width_wedges":0} kernel={"n_d7":34,"contrast":1.742,"r2":0.532,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 13 | {"epgRecur":3,"d7Gain":0.5,"epgTonic":3,"penGain":1} | persistence={"concentration":0,"seeded":0.454,"total_rate":0,"width_wedges":0} kernel={"n_d7":32,"contrast":1.662,"r2":0.632,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 14 | {"epgRecur":3,"d7Gain":0.5,"epgTonic":5,"penGain":1} | persistence={"concentration":0.818,"seeded":0.235,"total_rate":5.633,"width_wedges":2} kernel={"n_d7":31,"contrast":1.772,"r2":0.56,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":5.241,"tracked":4} | d7_silence,peg_lesion |
| 15 | {"epgRecur":3,"d7Gain":0.5,"epgTonic":7,"penGain":1} | persistence={"concentration":0.926,"seeded":0.163,"total_rate":1.433,"width_wedges":2} kernel={"n_d7":35,"contrast":1.672,"r2":0.643,"min_at_bump":true} rotL={"drift":9.923,"tracked":4} rotR={"drift":-7.714,"tracked":4} | d7_silence |
| 16 | {"epgRecur":3,"d7Gain":1,"epgTonic":0,"penGain":1} | persistence={"concentration":0,"seeded":0.971,"total_rate":0,"width_wedges":0} kernel={"n_d7":38,"contrast":1.728,"r2":0.604,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 17 | {"epgRecur":3,"d7Gain":1,"epgTonic":3,"penGain":1} | persistence={"concentration":0.943,"seeded":0.513,"total_rate":1.333,"width_wedges":1} kernel={"n_d7":32,"contrast":1.819,"r2":0.502,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | d7_silence,peg_lesion |
| 18 | {"epgRecur":3,"d7Gain":1,"epgTonic":5,"penGain":1} | persistence={"concentration":0.835,"seeded":0.199,"total_rate":7.067,"width_wedges":2} kernel={"n_d7":36,"contrast":1.695,"r2":0.644,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":10.272,"tracked":4} | d7_silence,peg_lesion |
| 19 | {"epgRecur":3,"d7Gain":1,"epgTonic":7,"penGain":1} | persistence={"concentration":0.925,"seeded":0.155,"total_rate":1.8,"width_wedges":2} kernel={"n_d7":39,"contrast":1.721,"r2":0.589,"min_at_bump":true} rotL={"drift":-5.452,"tracked":4} rotR={"drift":-0.493,"tracked":4} | peg_lesion |
| 20 | {"epgRecur":3,"d7Gain":1.3,"epgTonic":0,"penGain":1} | persistence={"concentration":0,"seeded":0.968,"total_rate":0,"width_wedges":0} kernel={"n_d7":34,"contrast":1.687,"r2":0.603,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 21 | {"epgRecur":3,"d7Gain":1.3,"epgTonic":3,"penGain":1} | persistence={"concentration":0,"seeded":0.946,"total_rate":0,"width_wedges":0} kernel={"n_d7":34,"contrast":1.722,"r2":0.572,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 22 | {"epgRecur":3,"d7Gain":1.3,"epgTonic":5,"penGain":1} | persistence={"concentration":0,"seeded":0.899,"total_rate":0,"width_wedges":0} kernel={"n_d7":38,"contrast":1.729,"r2":0.588,"min_at_bump":true} rotL={"drift":7.917,"tracked":4} rotR={"drift":-10.005,"tracked":4} | - |
| 23 | {"epgRecur":3,"d7Gain":1.3,"epgTonic":7,"penGain":1} | persistence={"concentration":0.864,"seeded":0.159,"total_rate":1.933,"width_wedges":2} kernel={"n_d7":36,"contrast":1.807,"r2":0.509,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":5.403,"tracked":4} | peg_lesion |
| 24 | {"epgRecur":4,"d7Gain":0.5,"epgTonic":0,"penGain":1} | persistence={"concentration":0,"seeded":0.935,"total_rate":0,"width_wedges":0} kernel={"n_d7":36,"contrast":1.706,"r2":0.592,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 25 | {"epgRecur":4,"d7Gain":0.5,"epgTonic":3,"penGain":1} | persistence={"concentration":0.879,"seeded":0.274,"total_rate":5.567,"width_wedges":2} kernel={"n_d7":30,"contrast":1.711,"r2":0.574,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":1} | peg_lesion |
| 26 | {"epgRecur":4,"d7Gain":0.5,"epgTonic":5,"penGain":1} | persistence={"concentration":0,"seeded":0.136,"total_rate":0,"width_wedges":0} kernel={"n_d7":39,"contrast":1.691,"r2":0.662,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 27 | {"epgRecur":4,"d7Gain":0.5,"epgTonic":7,"penGain":1} | persistence={"concentration":0.104,"seeded":0.162,"total_rate":72.833,"width_wedges":8} kernel={"n_d7":35,"contrast":1.753,"r2":0.575,"min_at_bump":true} rotL={"drift":6.358,"tracked":4} rotR={"drift":-1.082,"tracked":4} | - |
| 28 | {"epgRecur":4,"d7Gain":1,"epgTonic":0,"penGain":1} | persistence={"concentration":0,"seeded":0.953,"total_rate":0,"width_wedges":0} kernel={"n_d7":35,"contrast":1.796,"r2":0.51,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 29 | {"epgRecur":4,"d7Gain":1,"epgTonic":3,"penGain":1} | persistence={"concentration":0.892,"seeded":0.265,"total_rate":5.7,"width_wedges":2} kernel={"n_d7":35,"contrast":1.683,"r2":0.697,"min_at_bump":true} rotL={"drift":null,"tracked":1} rotR={"drift":4.322,"tracked":2} | peg_lesion |
| 30 | {"epgRecur":4,"d7Gain":1,"epgTonic":5,"penGain":1} | persistence={"concentration":0,"seeded":0.153,"total_rate":0,"width_wedges":0} kernel={"n_d7":39,"contrast":1.72,"r2":0.637,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 31 | {"epgRecur":4,"d7Gain":1,"epgTonic":7,"penGain":1} | persistence={"concentration":0,"seeded":0.17,"total_rate":0,"width_wedges":0} kernel={"n_d7":39,"contrast":1.751,"r2":0.595,"min_at_bump":true} rotL={"drift":-9.433,"tracked":4} rotR={"drift":-0.677,"tracked":4} | - |
| 32 | {"epgRecur":4,"d7Gain":1.3,"epgTonic":0,"penGain":1} | persistence={"concentration":0,"seeded":0.952,"total_rate":0,"width_wedges":0} kernel={"n_d7":38,"contrast":1.751,"r2":0.542,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 33 | {"epgRecur":4,"d7Gain":1.3,"epgTonic":3,"penGain":1} | persistence={"concentration":0.885,"seeded":0.223,"total_rate":4.667,"width_wedges":2} kernel={"n_d7":33,"contrast":1.798,"r2":0.529,"min_at_bump":true} rotL={"drift":7.482,"tracked":2} rotR={"drift":-1.905,"tracked":3} | peg_lesion |
| 34 | {"epgRecur":4,"d7Gain":1.3,"epgTonic":5,"penGain":1} | persistence={"concentration":0,"seeded":0.18,"total_rate":0,"width_wedges":0} kernel={"n_d7":37,"contrast":1.759,"r2":0.565,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 35 | {"epgRecur":4,"d7Gain":1.3,"epgTonic":7,"penGain":1} | persistence={"concentration":0.235,"seeded":0.169,"total_rate":22.133,"width_wedges":6} kernel={"n_d7":35,"contrast":1.734,"r2":0.591,"min_at_bump":true} rotL={"drift":1.407,"tracked":4} rotR={"drift":-9.414,"tracked":4} | d7_silence |
| 36 | {"epgRecur":6,"d7Gain":0.5,"epgTonic":0,"penGain":1} | persistence={"concentration":0,"seeded":0.14,"total_rate":0,"width_wedges":0} kernel={"n_d7":37,"contrast":1.681,"r2":0.659,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 37 | {"epgRecur":6,"d7Gain":0.5,"epgTonic":3,"penGain":1} | persistence={"concentration":1,"seeded":0.112,"total_rate":0.2,"width_wedges":0} kernel={"n_d7":32,"contrast":1.793,"r2":0.496,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | d7_silence,peg_lesion |
| 38 | {"epgRecur":6,"d7Gain":0.5,"epgTonic":5,"penGain":1} | persistence={"concentration":0,"seeded":0.114,"total_rate":0,"width_wedges":0} kernel={"n_d7":29,"contrast":1.656,"r2":0.644,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 39 | {"epgRecur":6,"d7Gain":0.5,"epgTonic":7,"penGain":1} | persistence={"concentration":0.229,"seeded":0.101,"total_rate":26.433,"width_wedges":7} kernel={"n_d7":31,"contrast":1.658,"r2":0.619,"min_at_bump":true} rotL={"drift":-0.407,"tracked":4} rotR={"drift":-6.291,"tracked":4} | peg_lesion |
| 40 | {"epgRecur":6,"d7Gain":1,"epgTonic":0,"penGain":1} | persistence={"concentration":0,"seeded":0.127,"total_rate":0,"width_wedges":0} kernel={"n_d7":38,"contrast":1.727,"r2":0.643,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 41 | {"epgRecur":6,"d7Gain":1,"epgTonic":3,"penGain":1} | persistence={"concentration":0,"seeded":0.103,"total_rate":0,"width_wedges":0} kernel={"n_d7":37,"contrast":1.718,"r2":0.578,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 42 | {"epgRecur":6,"d7Gain":1,"epgTonic":5,"penGain":1} | persistence={"concentration":0,"seeded":0.1,"total_rate":0,"width_wedges":0} kernel={"n_d7":33,"contrast":1.747,"r2":0.559,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 43 | {"epgRecur":6,"d7Gain":1,"epgTonic":7,"penGain":1} | persistence={"concentration":0.117,"seeded":0.118,"total_rate":97.933,"width_wedges":8} kernel={"n_d7":35,"contrast":1.709,"r2":0.628,"min_at_bump":true} rotL={"drift":-1.272,"tracked":4} rotR={"drift":2.186,"tracked":4} | - |
| 44 | {"epgRecur":6,"d7Gain":1.3,"epgTonic":0,"penGain":1} | persistence={"concentration":0,"seeded":0.118,"total_rate":0,"width_wedges":0} kernel={"n_d7":35,"contrast":1.732,"r2":0.625,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 45 | {"epgRecur":6,"d7Gain":1.3,"epgTonic":3,"penGain":1} | persistence={"concentration":0,"seeded":0.12,"total_rate":0,"width_wedges":0} kernel={"n_d7":38,"contrast":1.737,"r2":0.581,"min_at_bump":true} rotL={"drift":null,"tracked":0} rotR={"drift":null,"tracked":0} | - |
| 46 | {"epgRecur":6,"d7Gain":1.3,"epgTonic":5,"penGain":1} | persistence={"concentration":0,"seeded":0.115,"total_rate":0,"width_wedges":0} kernel={"n_d7":38,"contrast":1.73,"r2":0.658,"min_at_bump":true} rotL={"drift":-5.958,"tracked":4} rotR={"drift":2.376,"tracked":4} | - |
| 47 | {"epgRecur":6,"d7Gain":1.3,"epgTonic":7,"penGain":1} | persistence={"concentration":0.108,"seeded":0.114,"total_rate":95.7,"width_wedges":8} kernel={"n_d7":37,"contrast":1.631,"r2":0.724,"min_at_bump":true} rotL={"drift":-1.005,"tracked":4} rotR={"drift":-5.882,"tracked":4} | - |
