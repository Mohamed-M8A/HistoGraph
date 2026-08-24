/*
 * STATE.JS
 * ---------------------------------------------------------------------
 * Single source of truth for every piece of shared mutable state and
 * every constant lookup table used elsewhere in the app. This file is
 * loaded FIRST (before any other Histograph script), because every
 * other module reads or writes these globals.
 *
 * Holds:
 *   - Designer state: current token appearance (shape, hierarchy
 *     position, unit label position, format, font size, and font
 *     family) and the currently uploaded background image.
 *   - Session gallery state: the in-memory list of saved tokens.
 *   - Assets subsystem state: a libraryCache (Map) that stores
 *     bulk-uploaded flag/asset images in memory for immediate use by
 *     Mass Production.
 *   - PREFS_STORAGE_KEY: the localStorage key ui-controls.js uses to
 *     persist designer preferences (theme, shape, colors, font,
 *     hierarchy/label position, format, and which collapsible panels
 *     were left open) across page reloads.
 *   - Hardcoded limits: MAX_UNITS_PER_BATCH caps units per single
 *     batch line, and MAX_LINES_PER_BATCH caps the number of
 *     instruction lines (countries) allowed in a single batch run.
 *   - Mass Production lookup tables: NATO hierarchy symbols and their
 *     display names, weighted random distribution for hierarchy
 *     tiers, valid numeric label ranges per tier, available token
 *     shapes, and the recognized batch-instruction column names
 *     (both the canonical field names and the shorter aliases shown
 *     in the batch textarea's placeholder hint).
 * ---------------------------------------------------------------------
 */
let uploadedImage = "";
let uploadedImageNaturalW = 0;
let uploadedImageNaturalH = 0;
let uploadedImageIsSvg = false;
let uploadedImageSvgText = "";
let savedTokens = [];
let selectedShape = "shape-square";
let selectedPosition = "inside";
let selectedLabelPosition = "inside";
let selectedFormat = "png";
let fontSize = 35;
let selectedFontFamily = "Arial";
const HEX_BORDER_BOOST = 1.4;

const HIERARCHY_NAME_MAP = {
    "•": "Squad",
    "••": "Platoon",
    "•••": "Section",
    "I": "Company",
    "II": "Battalion",
    "III": "Regiment",
    "X": "Brigade",
    "XX": "Division",
    "XXX": "Corps",
    "XXXX": "Army",
    "XXXXX": "ArmyGroup"
};

const libraryCache = new Map(); 
const MAX_UNITS_PER_BATCH = 1000; 
const MAX_LINES_PER_BATCH = 200;
const PREFS_STORAGE_KEY = 'histograph_prefs_v1';

const HIERARCHY_TIERS = ["•", "••", "•••", "I", "II", "III", "X", "XX", "XXX", "XXXX", "XXXXX"];

const HIERARCHY_WEIGHTS = {
    "•": 25, "••": 20, "•••": 15, "I": 15, "II": 10, "III": 7,
    "X": 4, "XX": 2, "XXX": 1, "XXXX": 0.7, "XXXXX": 0.3
};

const LABEL_NUMBER_RANGES = {
    "•": [1, 300], "••": [1, 300], "•••": [1, 300],
    "I": [1, 300], "II": [1, 250], "III": [1, 150],
    "X": [1, 100], "XX": [1, 50], "XXX": [1, 30],
    "XXXX": [1, 12], "XXXXX": [1, 12]
};

const SHAPE_OPTIONS = ["shape-square", "shape-rounded", "shape-circle", "shape-hexagon"];

const BATCH_FIELD_NAMES = [
    "country",
    "hierarchy",
    "shape",
    "strokecolor", "stroke",
    "textcolor", "text",
    "bgcolor", "bg",
    "opacity",
    "fontfamily", "font",
    "fontsize", "size",
    "label",
    "imgzoom", "zoom",
    "imgoffsetx", "offx",
    "imgoffsety", "offy",
    "count"
];
