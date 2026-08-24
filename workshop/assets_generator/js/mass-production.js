/*
 * MASS-PRODUCTION.JS
 * ---------------------------------------------------------------------
 * Implements the "Mass Production" panel — parsing the user's
 * semicolon-delimited batch instructions (typed, pasted, or uploaded
 * as .txt/.csv), resolving each requested asset, generating every
 * requested unit, and packaging the whole batch into a downloadable
 * ZIP with a per-run report.
 *
 * Each instruction line has 14 semicolon-separated fields:
 *   country;hierarchy;shape;strokeColor;textColor;bgColor;opacity;
 *   fontFamily;fontSize;label;imgZoom;imgOffsetX;imgOffsetY;count
 * Any field may be left blank (an empty slot between two semicolons)
 * to fall back to its default. Leaving "country" blank skips the
 * background image entirely and produces a plain-color token — an
 * asset name is only required when one is actually referenced.
 * fontFamily accepts any CSS font-family string, not just the six
 * presets in the Unit Designer's Font panel. imgZoom/imgOffsetX/
 * imgOffsetY are never clamped, by design, so batch lines have the
 * same full range of motion as the live designer's sliders.
 *
 * hierarchy and shape both accept a fixed value or "random" for a
 * uniform/weighted random pick; hierarchy additionally supports
 * "random!excl,X,Y" (exclude tiers X and Y from the random pool) and
 * "random:incl,X,Y" (restrict the random pool to only X and Y).
 *
 * label accepts fixed text, a "[start-end]" numeric range that
 * auto-increments once per generated unit on that line, or is left
 * blank to auto-generate a unique random number scoped to that unit's
 * hierarchy tier.
 *
 * Contains:
 *   - handleBatchFileUpload(): loads a .txt/.csv file's contents into
 *     the batch instructions textarea.
 *   - looksLikeHeaderRow() / parseBatchInput(): splits raw batch text
 *     into instruction lines, skipping blank lines, comments, and an
 *     optional header row (recognized against BATCH_FIELD_NAMES in
 *     state.js, which includes both the canonical and the shorter
 *     placeholder-style column names).
 *   - parseBatchLine(): parses one instruction line into its 14
 *     fields with defaults applied, validating the requested count.
 *   - pickWeightedHierarchy() / resolveHierarchyForUnit(): implements
 *     the hierarchy random-selection modes, weighted by real-world
 *     unit frequency.
 *   - resolveShapeForUnit(): implements "random" shape selection.
 *   - generateNumericLabel(): generates a unique-per-tier numeric
 *     label when no explicit label was given.
 *   - measureImageNaturalSize() / svgTextToDataUrl() /
 *     measureSvgNaturalSize(): helpers to determine an asset's
 *     natural pixel dimensions for correct cover-cropping.
 *   - buildMassProductionUnitConfig(): assembles a single unit's full
 *     render config (shape, colors, resolved asset or none, label,
 *     etc.).
 *   - runMassProduction(): the main engine — parses all lines,
 *     resolves assets, generates every unit (canvas or SVG), and
 *     produces the final ZIP download plus an on-screen report.
 *   - renderMassProductionReport(): renders the generation report
 *     (counts and any rejected/skipped lines) into the report panel.
 * ---------------------------------------------------------------------
 */
function handleBatchFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('inBatchText').value = e.target.result;
    };
    reader.readAsText(file);
    event.target.value = '';
}

function looksLikeHeaderRow(line) {
    const fields = line.split(';').map(f => f.trim().toLowerCase());
    if (fields.length < 2) return false;
    const matchCount = fields.filter(f => BATCH_FIELD_NAMES.includes(f)).length;
    return matchCount >= Math.ceil(fields.length / 2);
}

function parseBatchInput(rawText) {
    const rawLines = rawText.split(/\r?\n/);
    const instructionLines = [];
    let lineNumber = 0;
    let firstDataLineSeen = false;

    rawLines.forEach(rawLine => {
        lineNumber++;
        const line = rawLine.trim();
        if (line === "" || line.startsWith('#')) return;

        if (!firstDataLineSeen) {
            firstDataLineSeen = true;
            if (looksLikeHeaderRow(line)) return;
        }

        instructionLines.push({ lineNumber, raw: line });
    });

    return instructionLines;
}

function parseBatchLine(entry, maxPerLine) {
    const fields = entry.raw.split(';').map(f => f.trim());
    while (fields.length < 14) fields.push('');

    const [country, hierarchyField, shapeField, strokeColorField, textColorField,
        bgColorField, opacityField, fontFamilyField, fontSizeField, labelField,
        imgZoomField, imgOffsetXField, imgOffsetYField, countField] = fields;

    const result = { lineNumber: entry.lineNumber, raw: entry.raw };

    const countRaw = countField === '' ? 1 : parseInt(countField, 10);
    if (isNaN(countRaw) || countRaw < 1) {
        result.error = `Invalid count value "${countField}"`;
        return result;
    }
    if (countRaw > maxPerLine) {
        result.error = `Count ${countRaw} exceeds max allowed per line (${maxPerLine})`;
        return result;
    }

    const parsedOpacity = parseFloat(opacityField);

    result.country = country;
    result.hierarchyField = hierarchyField === '' ? '' : hierarchyField;
    result.shapeField = shapeField === '' ? 'shape-square' : shapeField;
    result.strokeColor = strokeColorField === '' ? '#000000' : strokeColorField;
    result.textColor = textColorField === '' ? '#000000' : textColorField;
    result.bgColor = bgColorField === '' ? '#ffffff' : bgColorField;
    result.opacity = opacityField === '' || isNaN(parsedOpacity) ? 0.5 : parsedOpacity;
    result.fontFamily = fontFamilyField === '' ? 'Arial' : fontFamilyField;
    result.fontSize = fontSizeField === '' ? 35 : (parseInt(fontSizeField, 10) || 35);
    result.labelField = labelField;
    result.imgZoom = imgZoomField === '' ? 1 : (parseFloat(imgZoomField) || 1);
    result.imgOffsetX = imgOffsetXField === '' ? 0 : (parseFloat(imgOffsetXField) || 0);
    result.imgOffsetY = imgOffsetYField === '' ? 0 : (parseFloat(imgOffsetYField) || 0);
    result.count = countRaw;

    return result;
}

function pickWeightedHierarchy(pool) {
    const entries = pool.map(tier => [tier, HIERARCHY_WEIGHTS[tier]]);
    const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * totalWeight;
    for (const [tier, w] of entries) {
        roll -= w;
        if (roll <= 0) return tier;
    }
    return entries[entries.length - 1][0];
}

function resolveHierarchyForUnit(hierarchyField) {
    if (hierarchyField === 'random') {
        return pickWeightedHierarchy(HIERARCHY_TIERS);
    }
    if (hierarchyField.startsWith('random!')) {
        const excluded = hierarchyField.slice(7).split(',').map(s => s.trim()).filter(Boolean);
        const pool = HIERARCHY_TIERS.filter(t => !excluded.includes(t));
        return pool.length ? pickWeightedHierarchy(pool) : hierarchyField;
    }
    if (hierarchyField.startsWith('random:')) {
        const included = hierarchyField.slice(7).split(',').map(s => s.trim()).filter(Boolean);
        const pool = HIERARCHY_TIERS.filter(t => included.includes(t));
        return pool.length ? pickWeightedHierarchy(pool) : hierarchyField;
    }
    return hierarchyField;
}

function resolveShapeForUnit(shapeField) {
    if (shapeField === 'random') {
        return SHAPE_OPTIONS[Math.floor(Math.random() * SHAPE_OPTIONS.length)];
    }
    return shapeField;
}

function generateNumericLabel(tier, usedCombos) {
    const range = LABEL_NUMBER_RANGES[tier] || [1, 300];
    const rangeSize = range[1] - range[0] + 1;
    const maxAttempts = Math.min(rangeSize * 3, 2000);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const num = range[0] + Math.floor(Math.random() * rangeSize);
        const key = tier + '|' + num;
        if (!usedCombos.has(key)) {
            usedCombos.add(key);
            return String(num);
        }
    }
    return null;
}

function measureImageNaturalSize(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 250, height: 250 });
        img.src = src;
    });
}

function svgTextToDataUrl(svgText) {
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
}

function measureSvgNaturalSize(svgText) {
    return measureImageNaturalSize(svgTextToDataUrl(svgText));
}

async function buildMassProductionUnitConfig(parsed, tier, shape, labelText, asset) {
    const cfg = {
        shape: shape,
        position: 'inside',
        labelPosition: 'inside',
        color: parsed.bgColor,
        strokeColor: parsed.strokeColor,
        textColor: parsed.textColor,
        hierarchy: tier,
        number: labelText,
        opacity: parsed.opacity,
        fontFamily: parsed.fontFamily,
        fontSize: parsed.fontSize,
        imgZoom: parsed.imgZoom,
        imgOffsetX: parsed.imgOffsetX,
        imgOffsetY: parsed.imgOffsetY,
        imgW: 0,
        imgH: 0,
        image: null,
        assetType: null,
        assetSvgText: ""
    };

    if (!asset) return cfg;

    if (asset.type === 'svg') {
        cfg.assetType = 'svg';
        cfg.assetSvgText = asset.content;
        cfg.image = svgTextToDataUrl(asset.content);
        const dims = await measureSvgNaturalSize(asset.content);
        cfg.imgW = dims.width;
        cfg.imgH = dims.height;
    } else {
        cfg.assetType = 'raster';
        cfg.image = asset.content;
        const dims = await measureImageNaturalSize(asset.content);
        cfg.imgW = dims.width;
        cfg.imgH = dims.height;
    }

    return cfg;
}

async function runMassProduction() {
    if (!window.JSZip) {
        alert("ZIP library is unavailable right now (check your js/zip.js file).");
        return;
    }

    const rawText = document.getElementById('inBatchText').value;
    if (!rawText.trim()) {
        alert("Paste batch instructions first.");
        return;
    }

    const maxPerLine = MAX_UNITS_PER_BATCH;
    const entries = parseBatchInput(rawText);

    if (entries.length > MAX_LINES_PER_BATCH) {
        alert(`This batch has ${entries.length} lines, which exceeds the max allowed (${MAX_LINES_PER_BATCH}). Split it into smaller batches.`);
        return;
    }

    const report = {
        totalLines: entries.length,
        totalGenerated: 0,
        assetRejections: [],
        countRejections: [],
        otherErrors: []
    };

    const zip = new JSZip();
    const prefixRaw = document.getElementById('inMassPrefix').value;
    const prefix = sanitizeFileNameSegment(prefixRaw) || "MassProd";
    const format = selectedFormat;
    let globalIndex = 0;

    document.getElementById('massReport').innerText = "Generating mass production batch...";

    for (const entry of entries) {
        const parsed = parseBatchLine(entry, maxPerLine);
        if (parsed.error) {
            if (parsed.error.indexOf('Count') === 0) {
                report.countRejections.push({ line: entry.lineNumber, message: parsed.error });
            } else {
                report.otherErrors.push({ line: entry.lineNumber, message: parsed.error });
            }
            continue;
        }

        let asset = null;
        if (parsed.country) {
            asset = await resolveAsset(parsed.country);
            if (!asset) {
                report.assetRejections.push({ line: entry.lineNumber, message: `No asset found in library for "${parsed.country}"` });
                continue;
            }
        }

        const usedCombos = new Set();

        for (let i = 0; i < parsed.count; i++) {
            const tier = resolveHierarchyForUnit(parsed.hierarchyField);
            const shape = resolveShapeForUnit(parsed.shapeField);

            let labelText = parsed.labelField;
            
            const rangeMatch = labelText.match(/\[(\d+)-(\d+)\]/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1]);
                const end = parseInt(rangeMatch[2]);
                const currentNum = start <= end ? start + i : start - i;
                labelText = labelText.replace(/\[\d+-\d+\]/, currentNum);
            } else if (labelText === '') {
                const num = generateNumericLabel(tier, usedCombos);
                if (num === null) {
                    report.otherErrors.push({ line: entry.lineNumber, message: `Ran out of unique numbers for tier "${tier}"` });
                    continue;
                }
                labelText = num;
            }

            const unitCfg = await buildMassProductionUnitConfig(parsed, tier, shape, labelText, asset);
            globalIndex++;
            const fileName = buildFileNameFromParts(tier, labelText, globalIndex, prefix) + "." + format;

            if (format === 'svg') {
                zip.file(fileName, buildUnitSvgString(unitCfg));
                report.totalGenerated++;
            } else {
                await new Promise(resolve => {
                    renderUnitToCanvas(unitCfg, (dataUrl) => {
                        const base64Data = dataUrl.split(",")[1];
                        zip.file(fileName, base64Data, { base64: true });
                        report.totalGenerated++;
                        resolve();
                    });
                });
            }
        }
    }

    renderMassProductionReport(report);

    if (report.totalGenerated === 0) {
        alert("No units were generated. Check the report.");
        return;
    }

    zip.generateAsync({ type: "blob" }).then(function(content) {
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.download = `${prefix}_MassProduction.zip`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    });
}

function renderMassProductionReport(report) {
    const lines = [];
    lines.push(`Lines processed: ${report.totalLines}`);
    lines.push(`Units generated: ${report.totalGenerated}`);

    if (report.assetRejections.length) {
        lines.push('');
        lines.push('Rejected (missing asset):');
        report.assetRejections.forEach(r => lines.push(`  Line ${r.line}: ${r.message}`));
    }

    if (report.countRejections.length) {
        lines.push('');
        lines.push('Rejected (count too high):');
        report.countRejections.forEach(r => lines.push(`  Line ${r.line}: ${r.message}`));
    }

    if (report.otherErrors.length) {
        lines.push('');
        lines.push('Other issues:');
        report.otherErrors.forEach(r => lines.push(`  Line ${r.line}: ${r.message}`));
    }

    document.getElementById('massReport').innerText = lines.join('\n');
}
