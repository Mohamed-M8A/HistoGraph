import { loadConfig } from "./config.js";
import { loadUnitsRegistry } from "./system/unitsEngine.js";
import { MainRenderer } from "./system/MainRenderer.js";
import { EffectsManager } from "./system/effects.js";
import { BattleRecorder, downloadBlob, SimulationController } from "./system/Controller.js";
import { loadTerrainData } from "./terrain/terrainManager.js";
import { loadImage, imageToHeightmap } from "./terrain/loader.js";
import { createRng } from "./terrain/generator.js";
import { collectDomRefs, initTabs, initSettingsPanel, initInfoModal } from "./ui/domRefs.js";
import { MapEditor, renderStatesList, populatePaintStateOptions, renderSyntax } from "./ui/mapEditorPanel.js";
import { generateFullTerrain } from "./terrain/terrainManager.js";
import { InteractionManager } from "./ui/interactionManager.js";

const CELL_PIXEL_SIZE = 4;

// ==========================================================================
// Render-side RNG offset
//
// HumanPainter's building/keep shape variation (rotation, footprint choice,
// keep body/tower layout) is driven by an rng instance passed into
// setHumanElements. That rng must be deterministic from the same map seed
// so that generating the same seed twice produces visually identical
// output, but it must also be a completely separate instance from any rng
// consumed inside generateFullTerrain itself (settlement placement already
// advances its own rng a variable number of times depending on map
// content, so reusing that instance here would make the render-time draws
// depend on how many settlements happened to be placed, not just on the
// seed). RENDER_RNG_SEED_OFFSET is added to the base seed to derive a
// second, independent rng stream that is still fully reproducible from the
// same seed. The exact value only needs to avoid colliding with the
// offsets generator.js already uses internally for its own noise layers
// (seed, seed+101, seed+202, seed+303, seed+777) - it carries no other
// meaning.
// ==========================================================================
const RENDER_RNG_SEED_OFFSET = 999983;

async function init() {
  const [config] = await Promise.all([loadConfig(), loadTerrainData(), loadUnitsRegistry()]);

  const refs = collectDomRefs();
  const effectsManager = new EffectsManager();
  const renderer = new MainRenderer(refs.canvas, { seaLevel: config.map.seaLevel });
  const recorder = new BattleRecorder(refs.canvas, config.simulation.recordFps);
  const mapEditor = new MapEditor();

  renderer.setSun(config.visuals.sunAzimuth, config.visuals.sunAltitude);

  // ==========================================
  // Settings (seeded from config.json)
  // ==========================================
  let settings = {
    movementMode: "relative",
    mapWidth: config.map.defaultWidth,
    mapHeight: config.map.defaultHeight,
    seaLevel: config.map.seaLevel,
    riverCount: config.map.riverCount,
    tickDurationMs: config.simulation.tickDurationMs
  };

  const sim = new SimulationController(refs, settings, mapEditor, renderer, effectsManager);
  const interaction = new InteractionManager(refs, settings, mapEditor, renderer);

  sim.setupInitialState();
  interaction.init(sim.politicalGrid, () => sim.draw(), () => refreshUI());
  sim.onGridReplaced((grid) => interaction.setGrid(grid));

  function draw() {
    sim.draw();
  }

  function refreshUI() {
    renderStatesList(refs, mapEditor, refreshUI, "No states defined yet.");
    populatePaintStateOptions(refs, mapEditor, "Add a state first");
    renderSyntax(refs, mapEditor, "No commands recorded.");
  }

  // ==========================================
  // Map Generation
  // ==========================================
  function generate(customHeightmap = null) {
    const seed = Number(refs.seedInput.value) || Math.floor(Math.random() * 1000000);
    refs.seedInput.value = seed;

    refs.canvas.width = settings.mapWidth * CELL_PIXEL_SIZE;
    refs.canvas.height = settings.mapHeight * CELL_PIXEL_SIZE;

    const fullMap = generateFullTerrain(
      settings.mapWidth,
      settings.mapHeight,
      seed,
      { seaLevel: settings.seaLevel, riverCount: settings.riverCount },
      customHeightmap
    );
    sim.unitsState.terrain = fullMap.terrain;
    sim.unitsState.elevation = fullMap.elevation;
    renderer.setMapSize(settings.mapWidth, settings.mapHeight);
    renderer.setTerrain(fullMap.terrain, fullMap.elevation, settings.seaLevel);

    const renderRng = createRng(seed + RENDER_RNG_SEED_OFFSET);
    renderer.setHumanElements(fullMap.settlements, fullMap.roads, fullMap.elevation, renderRng, fullMap.terrain);

    draw();
  }

  // ==========================================
  // Event Wiring
  // ==========================================
  refs.generateMapBtn.onclick = () => generate();
  refs.loadBtn.onclick = () => sim.reset();
  refs.playBtn.onclick = () => sim.start();
  refs.pauseBtn.onclick = () => sim.pause();
  refs.resetBtn.onclick = () => sim.reset();

  refs.uploadMapInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = await loadImage(file);
    const hMap = imageToHeightmap(img, settings.mapWidth, settings.mapHeight);
    generate(hMap);
  };

  refs.recordBtn.onclick = async () => {
    if (!recorder.isRecording()) {
      recorder.start();
      refs.recordBtn.textContent = "Stop Recording";
      refs.recordBtn.classList.add("is-recording");
    } else {
      const blob = await recorder.stop();
      if (blob) downloadBlob(blob, `sim-${Date.now()}.webm`);
      refs.recordBtn.textContent = "Start Recording";
      refs.recordBtn.classList.remove("is-recording");
    }
  };

  refs.exportBtn.onclick = () => {
    const text = mapEditor.buildScriptText();
    downloadBlob(new Blob([text], { type: "text/plain" }), "political-map.txt");
  };

  refs.importBtn.onclick = () => {
    const { added } = mapEditor.importStrict(refs.importText.value);
    if (added > 0) refreshUI();
  };

  refs.clearMapBtn.onclick = () => {
    sim.setupInitialState();
    mapEditor.clearScript();
    refreshUI();
    draw();
  };

  initTabs(refs);
  initSettingsPanel(refs, settings, (s) => {
    Object.assign(settings, s);
    sim.setupInitialState();
    generate();
  });
  initInfoModal(refs);

  generate();

  const anim = (now) => {
    effectsManager.update(now);
    draw();
    requestAnimationFrame(anim);
  };
  requestAnimationFrame(anim);
}

init();