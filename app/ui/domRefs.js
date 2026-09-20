// ==========================================
// 1. DOM Reference Collection
// ==========================================
export function collectDomRefs() {
  return {
    canvas: document.getElementById("map-canvas"),
    canvasArea: document.querySelector(".canvas-area"),
    fullscreenBtn: document.getElementById("fullscreen-btn"),
    tabUnitsBtn: document.getElementById("tab-units-btn"),
    tabMapBtn: document.getElementById("tab-map-btn"),
    unitsPanel: document.getElementById("units-panel"),
    mapEditorPanel: document.getElementById("map-editor-panel"),
    seedInput: document.getElementById("seed-input"),
    generateMapBtn: document.getElementById("generate-map-btn"),
    uploadMapInput: document.getElementById("upload-map-input"),
    mapStatus: document.getElementById("map-status"),
    scriptInput: document.getElementById("script-input"),
    loadBtn: document.getElementById("load-btn"),
    playBtn: document.getElementById("play-btn"),
    pauseBtn: document.getElementById("pause-btn"),
    resetBtn: document.getElementById("reset-btn"),
    status: document.getElementById("status"),
    errors: document.getElementById("errors"),
    recordBtn: document.getElementById("record-btn"),
    stateCodeInput: document.getElementById("state-code-input"),
    stateColorInput: document.getElementById("state-color-input"),
    addStateBtn: document.getElementById("add-state-btn"),
    statesList: document.getElementById("states-list"),
    importText: document.getElementById("import-text"),
    importBtn: document.getElementById("import-btn"),
    importUploadInput: document.getElementById("import-upload-input"),
    importStatus: document.getElementById("import-status"),
    paintStateSelect: document.getElementById("paint-state-select"),
    paintShapeSelect: document.getElementById("paint-shape-select"),
    paintBrushInput: document.getElementById("paint-brush-input"),
    paintBrushValue: document.getElementById("paint-brush-value"),
    paintTickInput: document.getElementById("paint-tick-input"),
    paintModeBtn: document.getElementById("paint-mode-btn"),
    paintEraseBtn: document.getElementById("paint-erase-btn"),
    syntaxOutput: document.getElementById("syntax-output"),
    exportBtn: document.getElementById("export-btn"),
    clearMapBtn: document.getElementById("clear-map-btn"),
    politicalOpacityInput: document.getElementById("political-opacity-input"),
    politicalVisibleCheckbox: document.getElementById("political-visible-checkbox"),
    settingsToggleBtn: document.getElementById("settings-toggle-btn"),
    settingsPanel: document.getElementById("settings-panel"),
    settingsCloseBtn: document.getElementById("settings-close-btn"),
    movementModeSelect: document.getElementById("movement-mode-select"),
    mapWidthInput: document.getElementById("map-width-input"),
    mapHeightInput: document.getElementById("map-height-input"),
    seaLevelInput: document.getElementById("sea-level-input"),
    applySettingsBtn: document.getElementById("apply-settings-btn"),
    infoOverlay: document.getElementById("info-overlay"),
    infoModalTitle: document.getElementById("info-modal-title"),
    infoModalBody: document.getElementById("info-modal-body"),
    infoModalClose: document.getElementById("info-modal-close")
  };
}

// ==========================================
// 2. Tabs
// ==========================================
export function initTabs(refs) {
  const activate = (tab) => {
    const isUnits = tab === "units";
    refs.unitsPanel.classList.toggle("active", isUnits);
    refs.mapEditorPanel.classList.toggle("active", !isUnits);
    refs.tabUnitsBtn.classList.toggle("is-active", isUnits);
    refs.tabMapBtn.classList.toggle("is-active", !isUnits);
  };
  refs.tabUnitsBtn.onclick = () => activate("units");
  refs.tabMapBtn.onclick = () => activate("map");
}

// ==========================================
// 3. Settings Panel
// ==========================================
export function initSettingsPanel(refs, currentSettings, onApply) {
  refs.settingsToggleBtn.onclick = () => refs.settingsPanel.classList.add("open");
  refs.settingsCloseBtn.onclick = () => refs.settingsPanel.classList.remove("open");

  refs.mapWidthInput.value = currentSettings.mapWidth;
  refs.mapHeightInput.value = currentSettings.mapHeight;
  refs.seaLevelInput.value = currentSettings.seaLevel;
  refs.movementModeSelect.value = currentSettings.movementMode;

  refs.applySettingsBtn.onclick = () => {
    const settings = {
      movementMode: refs.movementModeSelect.value,
      mapWidth: Number(refs.mapWidthInput.value) || 160,
      mapHeight: Number(refs.mapHeightInput.value) || 100,
      seaLevel: Number(refs.seaLevelInput.value) || 0
    };
    onApply(settings);
    refs.settingsPanel.classList.remove("open");
  };
}

// ==========================================
// 4. Info Modal
// ==========================================
export function initInfoModal(refs) {
  const infoData = {
    map_info_title: "Map Generation",
    map_info_body: "Seed determines terrain layout. You can also upload an image to match colors to terrain types.",
    units_info_title: "Unit Commands",
    units_info_body: "Use SPAWN, MOV, DEL, FADE, and ATK commands. Example: T1 SPAWN 1 FR 20 20;",
    import_info_title: "Importing States",
    import_info_body: "Strict syntax: STATE [Code] [HexColor]; each line must end with a semicolon.",
    paint_info_title: "Painting Tool",
    paint_info_body: "Select a state and click/drag on the map. Use Rectangle mode for large areas.",
    syntax_info_title: "Generated Script",
    syntax_info_body: "All map changes are recorded here in real-time as political script commands."
  };

  document.querySelectorAll(".info-btn").forEach(btn => {
    btn.onclick = () => {
      const titleKey = btn.dataset.titleKey;
      const bodyKey = btn.dataset.bodyKey;
      refs.infoModalTitle.textContent = infoData[titleKey] || "Info";
      refs.infoModalBody.textContent = infoData[bodyKey] || "";
      refs.infoOverlay.classList.add("open");
    };
  });

  refs.infoModalClose.onclick = () => refs.infoOverlay.classList.remove("open");
  refs.infoOverlay.onclick = (e) => {
    if (e.target === refs.infoOverlay) refs.infoOverlay.classList.remove("open");
  };
}
