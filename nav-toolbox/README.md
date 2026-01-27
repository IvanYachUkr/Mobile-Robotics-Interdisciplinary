# Navigation Toolbox Visualization Suite

## Overview
This is an interactive web-based presentation tool illustrating the four levels of spatial representation in navigation, plus bidirectional interactions and robotics control limitations.

**Thesis:** Navigation capability emerges from the interaction of four representational levels (Sensorimotor, Primitives, Constructs, Symbols), where top-down beliefs shape bottom-up perception.

## Installation & Running

This project uses **Preact** via ES Modules and requires no build step. It runs offline once dependencies are present (included in `vendor/`).

### Prerequisites
- Python (pre-installed on most systems)

### How to Run
1. Open a terminal in the project folder:
   ```bash
   cd nav-toolbox
   ```
2. Start the local server:
   ```bash
   python -m http.server
   ```
3. Open your browser to:
   [http://localhost:8000](http://localhost:8000)

## Tabs Guide

### 1. Sensorimotor
Direct connection between sensors and motors (Tropism, Taxis). No memory or map.
- *Interact:* Watch the robot and plants react to the sun.

### 2. Spatial Primitives
Modular components (Compass, Odometry, Landmarks).
- *Interact:* Toggle modes. Note how Odometry drifts without landmarks (Red Ghost).

### 3. Spatial Constructs
Flexible map-based planning (Graphs/SLAM).
- *Interact:* Move the goal. Vector/Route modes fail to adapt, but Map mode re-routes efficiently.

### 4. Spatial Symbols
External guidance (Maps, Instructions).
- *Interact:* Use "Cards" to command the robot without it needing to explore first.

### 5. Bidirectionality
Top-down beliefs (Priors) vs Bottom-Up perception (Loop Closure).
- *Interact:* Set a "Wrong" prior and watch the belief heatmap bias the interpretation of the ambiguous world.

### 6. Limitations
Representation needs Control.
- *Interact:* Compare the "Naive" controller (jerky) vs the "Stable" controller (smooth) following the same path plan.
