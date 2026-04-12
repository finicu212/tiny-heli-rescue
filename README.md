# tiny heli rescue

2.5D single-rotor helicopter sim for the browser. Cozy search & rescue toy built on a real flight model. Spun off from REDLINE (same stack, same debug-panel style). Built for Chrome on Windows, targeting a steady 144 fps or more.

Design rule, in order: **1. accurate sim → 2. the world reacts to you ("the wall must not ignore me") → 3. 144 fps+ → 4. graphics.**

## Run

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # 71 unit tests (flight model, world, missions, audio mapping, input)
npm run build
```

`/?fly&seed=1234&wind=gusty` skips the menu.

## Flight model (`src/sim/`)

One rigid body with 6 degrees of freedom, fixed 400 Hz step, and no allocation inside `step()`.

| Subsystem | Model |
|---|---|
| Main-rotor thrust | Blade-element CT(θ₇₅, λ, μ) with a soft blade-stall cap on CT/σ that tightens with μ (retreating-blade stall) |
| Inflow | Dynamic inflow lag. Glauert momentum theory in climb and forward flight, Johnson empirical curve through the **vortex-ring state**, windmill-brake branch in fast descent, blended by in-plane speed |
| VRS | Onset around Vc ≈ −0.3…−1.7 vh at low airspeed. Unsteady thrust and buffet. Thrust loss grows with collective (pulling makes it worse), plus extra power. You recover by flying forward or sideways |
| Ground effect | Cheeseman–Bennett, faded with forward speed, works over roofs too |
| Disc flapping | First-order tilt with τ = 16/(γΩ). Gyroscopic lag gives pitch/roll damping. Includes flapback (a₁), coning lateral flap and the transverse-flow roll at ETL. Teetering hub with a mast-bump stop, so control authority fades at low g |
| Anti-torque | The tail rotor has its own inflow and VRS, so fast right yaw produces LTE. Shaft-torque reaction yaws the fuselage nose-right, and a sharp collective pull gives a torque kick. Tail-rotor drift means the heli hovers left skid low |
| Drivetrain | Free turbine: N1 lag with accel/decel limits, N2 governor with collective anticipator, torque that rises as N2 droops. A sprag clutch lets the NR and N2 needles split in autorotation |
| Autorotation | Emerges from the aerodynamics. Full-down collective overspeeds the rotor, and raising collective bleeds RPM |
| Airframe | Fuselage drag and download, a horizontal stabiliser that hits the rotor wake in transition (pitch-up), a weathercocking vertical fin |
| Contact | Four skid springs with regularised friction. Crashes: hard landing, rollover, rotor or tail strike, obstacle, ditching |
| Safety | A finite-state guard rolls the heli back to a snapshot if any value goes NaN |

## Air you can see (`src/render/fx.js`)

- **Motes**: ambient air specks carried by the rotor's induced-flow field (inflow, contracting wake, ground outwash, VRS torus). They brighten and streak where the air moves fastest.
- **Tip-vortex rings**: shed once per blade passage and carried away by the wake. In VRS they stall around the disc, wobble and turn red.
- **Tip vapour helices** appear under high blade loading or high g.
- **Downwash**: dust, grass, snow, spray or roof grit depending on the surface, plus ripples on water.
- **Persistent decals** painted into the terrain cache: flattened-grass rings from hovering, skid marks, scorch and crater marks.
- Screen shake and gamepad rumble from VRS buffet, ETL shudder, blade stall and hard contact.

## World and missions

Seeded procedural terrain covering 4 km × 4 km, with ridged mountains and lakes. It includes 8 towns on street grids and landing pads of several kinds: town square, rooftop, mountain summit, lake shore and ridge.

Missions take you pad to pad. You score by touchdown sink rate (BUTTER / SMOOTH / FIRM / HARD), how well you centre on the pad, and time, with a streak multiplier on top. Best score is stored locally.

## Audio (`src/audio/`)

An AudioWorklet synth with sample-accurate blade timing:

- rotor thump
- BVI slap (in descent, VRS and high-g turns)
- blade swish
- tail-rotor buzz
- turbine whine and combustion roar
- gearbox whine
- airflow
- skid scrape
- low-rotor-RPM horn, VRS whoop, engine-out beeps
- one-shots for thud, crash, splash and chime

## Debug panel (`` ` ``)

It follows REDLINE's layout:

- **Drivetrain**: N1, N2, NR, tail-rotor RPM, torque, shaft reaction
- **Controls**: collective θ₀, cyclic against disc tilt, pedal against tail-rotor pitch and anti-torque thrust
- **Rotor aero**: thrust, g, CT/σ with stall, vi against vh, Vc and μ, VRS, IGE, ETL
- **Status pills**
- **Live swashplate cutaway**: servos, a stationary plate that tilts with cyclic and rises with collective, a rotating plate spinning at rotor RPM, pitch links placed 90° ahead and blade paddles twisting through θ(ψ). A θ-per-revolution graph marks where each blade is
- **Audio levels** per layer
- **Frame-time sparkline** with 144 and 60 fps lines

## Controls

| Input | Action |
|---|---|
| W / S (Shift = fine), mouse wheel | Collective |
| Arrows / IJKL | Cyclic (returns to trim) |
| Click | Lock the mouse and fly cyclic with it (it stays where you leave it) |
| A / D (Q / E) | Pedals |
| T / right-click | Force trim: hold current cyclic and pedal |
| C | Centre trim |
| F (hold) | Cut or relight the engine to practise autorotation |
| G | Toggle SAS rate damping |
| R / N | Reset to last pad / new target |
| + / − | Zoom |
| H, `` ` ``, Tab, M, P | Help, debug, minimap, mute, pause |
| Gamepad | Right stick cyclic, left stick X pedals, LT/RT or left stick Y collective, A trim, B engine, Y reset |

## Performance notes

- The camera orientation never changes, so each 64 m terrain chunk (terrain, streets, buildings, trees, pads) is painted into an offscreen bitmap once. Each frame only blits the chunks. New chunks are generated under a time budget per frame.
- The helicopter is about 60 flat-shaded faces, with shade strings computed ahead of time, back-face culling and a painter's sort.
- Particles use fixed-size typed-array pools. Motes are drawn as 3 batched paths.
- Audio runs on the audio thread, and parameters are sent at about 90 Hz.
- Render DPR is capped at 1.5× by default. The menu lets you choose 1× or 2×.
