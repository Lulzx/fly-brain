# 1. Overview

## Goal
Put the male fruit fly connectome in a physically realistic body, place it in environments, and let the
brain decide what the fly does. Nothing about the fly's choices is scripted.

## The closed loop
Every simulated millisecond, for each fly:

1. The physics state is read: joint angles, foot contacts, body position, head orientation.
2. Senses convert that state into firing rates of identified sensory neurons.
3. The eyes cast rays, run the flyvis optic-lobe model, and drive matching optic-lobe neurons.
4. The brain advances two 0.5 ms spiking steps over 10.5 million connections.
5. The motor layer reads descending and motor neurons and sets actuator targets.
6. MuJoCo advances the body five 0.2 ms physics steps.

## Components

| Component | Source | Role |
|---|---|---|
| Connectome | Janelia FlyEM + Google, male CNS v1.0 | Wiring of brain and ventral nerve cord |
| Brain model | This project, after Shiu et al. 2024 | Spiking dynamics over the connectome |
| Body | flybody, Vaxenburg et al. 2024 | Anatomical fly model in MuJoCo |
| Vision | flyvis, Lappalainen et al. 2024 | Trained model of 65 optic-lobe cell types |
| Gait kinematics | FlySuite walking dataset | Real-fly joint trajectories |

## Two motor modes
- **Descending commands** is the default. The brain's descending neurons set walking, turning, backing,
  grooming, and escape. A stepping pattern generator executes the legs. This mirrors published embodied
  models such as NeuroMechFly v2 and Eon Systems' fly.
- **Full connectome VNC** is experimental. Every leg muscle is driven by its own motor neurons through the
  raw nerve-cord wiring. The fly cannot stand in this mode, which is the honest result.

## Scale
One fly runs at about 0.2 times real time. Five flies ran together on a 12-core Mac.
