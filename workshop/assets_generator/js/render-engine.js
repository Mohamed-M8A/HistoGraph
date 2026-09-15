/*
 * RENDER-ENGINE.JS
 * ---------------------------------------------------------------------
 * Everything involved in turning a unit config object into a
 * finished, downloadable token — shared shape/coordinate math, the
 * canvas (PNG) export engine, the SVG export engine, and the file
 * naming helpers used by both.
 *
 * Contains:
 *   Geometry / shared math:
 *   - The fixed token bounding box constants (EX, EY, EW, EH).
 *   - hexagonPoints(): computes the six corner points of the hexagon
 *     token shape.
 *   - getCoverGeometry(): computes "background-size: cover"-style
 *     width/height/offset for placing a background image/flag inside
 *     a box, honoring zoom and X/Y offset percentages.
 *   - buildShapePath(): draws the active token shape (square, rounded,
 *     circle, hexagon) onto a canvas 2D context.
 *   - drawOutwardBorder(): strokes the token's outer border along the
 *     active shape.
 *   - roundRect(): low-level canvas helper for drawing a rounded
 *     rectangle path.
 *   - wrapText(): greedy word-wrap helper used to break long unit
 *     labels into multiple lines that fit the token width.
 *
 *   Canvas (PNG) export:
 *   - renderTokenToCanvas(): convenience wrapper that renders the
 *     token currently configured in the Unit Designer panel.
 *   - renderUnitToCanvas(): renders an arbitrary unit config object to
 *     the hidden canvas, loading the background image asynchronously
 *     first if one is set.
 *   - finishCanvasUnit(): draws the hierarchy symbol and unit label
 *     (each independently inside or outside the shape, per the
 *     config's position/labelPosition), plus the outward border, on
 *     top of the shape/background, then hands back the finished PNG
 *     data URL via callback. The shape's clip region is released
 *     before any of this drawing happens, so elements positioned
 *     outside the shape's bounds are never clipped away.
 *
 *   SVG export:
 *   - svgShapeElement(): returns the SVG markup for the active token
 *     shape (rect, rounded rect, circle, or hexagon polygon).
 *   - buildSvgString(): convenience wrapper around buildUnitSvgString()
 *     using the current Unit Designer config.
 *   - buildUnitSvgString(): assembles the full <svg> document for a
 *     unit config object. Hierarchy and label elements are routed
 *     into the shape's clipped group only when positioned "inside";
 *     "outside" elements are placed after the clipped group so
 *     they're never clipped away.
 *   - escapeXml(): escapes text for safe inclusion inside SVG <text>
 *     elements.
 *   - parseSvgViewBox(): reads (or derives) the viewBox of an uploaded
 *     SVG asset so it can be scaled correctly.
 *   - sanitizeSvgAssetNode(): strips <script> elements and any
 *     event-handler ("on*") attributes from an uploaded SVG asset
 *     before it is inlined into an export.
 *   - buildInlineSvgAssetMarkup(): inlines an uploaded SVG flag/image
 *     as true vector markup, scaled and positioned to match the
 *     cover/zoom/offset rules used for raster images.
 *
 *   File naming / single-token download:
 *   - removeUnitWord(): strips the standalone word "unit" out of a
 *     label before it becomes part of a file name.
 *   - sanitizeFileNameSegment(): strips illegal characters and
 *     normalizes whitespace/underscores for use in a file name.
 *   - buildFileNameFromParts(): assembles the final file name from an
 *     optional prefix, batch index, hierarchy word, and sanitized
 *     label.
 *   - downloadToken(): reads the current Unit Designer config and
 *     triggers a PNG or SVG download of the single token being edited.
 * ---------------------------------------------------------------------
 */
const EX = 75, EY = 100, EW = 350, EH = 350;

function hexagonPoints(x, y, w, h) {
    return [
        [x + w * 0.25, y],
        [x + w * 0.75, y],
        [x + w, y + h * 0.5],
        [x + w * 0.75, y + h],
        [x + w * 0.25, y + h],
        [x, y + h * 0.5]
    ];
}

function getCoverGeometry(imgW, imgH, boxW, boxH, zoom, offXPercent, offYPercent) {
    const boxRatio = boxW / boxH;
    const imgRatio = imgW / imgH;
    let coverW, coverH;
    if (imgRatio > boxRatio) {
        coverH = boxH;
        coverW = boxH * imgRatio;
    } else {
        coverW = boxW;
        coverH = boxW / imgRatio;
    }
    coverW *= zoom;
    coverH *= zoom;
    const overflowX = coverW - boxW;
    const overflowY = coverH - boxH;
    const x = -overflowX * ((offXPercent + 50) / 100);
    const y = -overflowY * ((offYPercent + 50) / 100);
    return { width: coverW, height: coverH, x, y };
}

function buildShapePath(ctx, x, y, w, h, shape = selectedShape) {
    ctx.beginPath();
    if (shape === 'shape-circle') {
        ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
    } else if (shape === 'shape-rounded') {
        roundRect(ctx, x, y, w, h, 40 * (w / EW));
    } else if (shape === 'shape-hexagon') {
        const pts = hexagonPoints(x, y, w, h);
        ctx.moveTo(pts[0][0], pts[0][1]);
        pts.slice(1).forEach(p => ctx.lineTo(p[0], p[1]));
        ctx.closePath();
    } else {
        ctx.rect(x, y, w, h);
    }
}

function drawOutwardBorder(ctx, strokeColor, shape = selectedShape) {
    const lw = 15 * (shape === 'shape-hexagon' ? HEX_BORDER_BOOST : 1);
    const pad = lw / 2;
    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lw;
    buildShapePath(ctx, EX - pad, EY - pad, EW + pad * 2, EH + pad * 2, shape);
    ctx.stroke();
    ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    words.forEach(word => {
        const test = line ? line + ' ' + word : word;
        if (line && ctx.measureText(test).width > maxWidth) {
            lines.push(line);
            line = word;
        } else {
            line = test;
        }
    });
    if (line) lines.push(line);
    return lines;
}

function renderTokenToCanvas(onReady) {
    renderUnitToCanvas(buildDesignerConfig(), onReady);
}

function renderUnitToCanvas(cfg, onReady) {
    const canvas = document.getElementById('canvas-hidden');
    const ctx = canvas.getContext('2d');
    const size = 500;

    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = cfg.color;
    buildShapePath(ctx, EX, EY, EW, EH, cfg.shape);
    ctx.fill();

    ctx.save();
    buildShapePath(ctx, EX, EY, EW, EH, cfg.shape);
    ctx.clip();

    if (cfg.image) {
        const img = new Image();
        img.onload = () => {
            try {
                ctx.globalAlpha = cfg.opacity;
                const geo = getCoverGeometry(img.naturalWidth || cfg.imgW, img.naturalHeight || cfg.imgH, EW, EH, cfg.imgZoom, cfg.imgOffsetX, cfg.imgOffsetY);
                ctx.drawImage(img, EX + geo.x, EY + geo.y, geo.width, geo.height);
                ctx.globalAlpha = 1.0;
                finishCanvasUnit(ctx, size, cfg, onReady);
            } catch (err) {
                alert("Something went wrong while drawing the image. Try again or choose another image.");
                ctx.globalAlpha = 1.0;
                finishCanvasUnit(ctx, size, cfg, onReady);
            }
        }
        img.onerror = () => {
            alert("Failed to load the background image. Try again or choose another image.");
            finishCanvasUnit(ctx, size, cfg, onReady);
        }
        img.src = cfg.image;
    } else {
        finishCanvasUnit(ctx, size, cfg, onReady);
    }
}

function finishCanvasUnit(ctx, size, cfg, onReady) {
    ctx.restore();

    const scale = EW / 250;
    const labelPosition = cfg.labelPosition || 'inside';

    ctx.fillStyle = cfg.textColor;
    ctx.textAlign = "center";

    if (cfg.position === 'inside') {
        ctx.font = `bold ${80 * scale}px ${cfg.fontFamily}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(cfg.hierarchy, size / 2, size * 0.5);
        ctx.textBaseline = 'alphabetic';
    } else {
        ctx.font = `bold ${35.2 * scale}px ${cfg.fontFamily}`;
        ctx.fillText(cfg.hierarchy, size / 2, 80);
    }

    const labelText = (cfg.number || "").toUpperCase();
    ctx.font = `900 ${cfg.fontSize}px ${cfg.fontFamily}`;
    const maxLabelWidth = EW - 20 * scale;
    const lines = wrapText(ctx, labelText, maxLabelWidth);
    const lineHeight = cfg.fontSize * 1.2;

    if (labelPosition === 'outside') {
        const startY = EY + EH + 35 + lineHeight;
        lines.forEach((line, i) => {
            ctx.fillText(line, size / 2, startY + i * lineHeight);
        });
    } else {
        const reserveBuffer = lineHeight * 0.5;
        const baseY = size - 50 - reserveBuffer;
        lines.forEach((line, i) => {
            ctx.fillText(line, size / 2, baseY - (lines.length - 1 - i) * lineHeight);
        });
    }

    drawOutwardBorder(ctx, cfg.strokeColor, cfg.shape);

    onReady(document.getElementById('canvas-hidden').toDataURL(), cfg.number);
}

function svgShapeElement(x, y, w, h, attrs, shape = selectedShape) {
    if (shape === 'shape-circle') {
        return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2}" ${attrs} />`;
    } else if (shape === 'shape-rounded') {
        const r = 40 * (w / EW);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" ${attrs} />`;
    } else if (shape === 'shape-hexagon') {
        const pts = hexagonPoints(x, y, w, h).map(p => p[0] + "," + p[1]).join(" ");
        return `<polygon points="${pts}" ${attrs} />`;
    } else {
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs} />`;
    }
}

function buildSvgString(customConfig = null) {
    return buildUnitSvgString(customConfig || buildDesignerConfig());
}

function buildUnitSvgString(cfg) {
    const size = 500;
    const shape = cfg.shape || selectedShape;
    const position = cfg.position || selectedPosition;
    const labelPosition = cfg.labelPosition || 'inside';
    const fontFamily = cfg.fontFamily || 'Arial';

    const fillShapeTag = svgShapeElement(EX, EY, EW, EH, `fill="${cfg.color}"`, shape);
    const clipTag = `<clipPath id="clip">${svgShapeElement(EX, EY, EW, EH, "", shape)}</clipPath>`;
    const borderWidth = 15 * (shape === 'shape-hexagon' ? HEX_BORDER_BOOST : 1);
    const pad = borderWidth / 2;
    const borderShapeTag = svgShapeElement(EX - pad, EY - pad, EW + pad * 2, EH + pad * 2, `fill="none" stroke="${cfg.strokeColor}" stroke-width="${borderWidth}"`, shape);

    let assetTag = "";
    if (cfg.assetType === 'svg' && cfg.assetSvgText) {
        assetTag = buildInlineSvgAssetMarkup(cfg.assetSvgText, cfg.imgW, cfg.imgH, EX, EY, EW, EH, cfg.imgZoom, cfg.imgOffsetX, cfg.imgOffsetY, cfg.opacity);
    } else if (cfg.image) {
        const geo = getCoverGeometry(cfg.imgW || 250, cfg.imgH || 250, EW, EH, cfg.imgZoom, cfg.imgOffsetX, cfg.imgOffsetY);
        assetTag = `<image href="${cfg.image}" x="${EX + geo.x}" y="${EY + geo.y}" width="${geo.width}" height="${geo.height}" opacity="${cfg.opacity}" preserveAspectRatio="none" />`;
    }

    const svgFontSize = cfg.fontSize || fontSize;
    const scale = EW / 250;
    const labelText = (cfg.number || "").toUpperCase();
    const measureCtx = document.getElementById('canvas-hidden').getContext('2d');
    measureCtx.font = `900 ${svgFontSize}px ${fontFamily}`;
    const lines = wrapText(measureCtx, labelText, EW - 20 * scale);
    const lineHeight = svgFontSize * 1.2;

    let labelTags;
    if (labelPosition === 'outside') {
        const startY = EY + EH + 35 + lineHeight;
        labelTags = lines.map((line, i) =>
            `<text x="${size/2}" y="${startY + i * lineHeight}" text-anchor="middle" font-family="${fontFamily}" font-weight="900" font-size="${svgFontSize}" fill="${cfg.textColor}">${escapeXml(line)}</text>`
        ).join('\n  ');
    } else {
        const baseY = size - 50 - (lineHeight * 0.5);
        labelTags = lines.map((line, i) =>
            `<text x="${size/2}" y="${baseY - (lines.length - 1 - i) * lineHeight}" text-anchor="middle" font-family="${fontFamily}" font-weight="900" font-size="${svgFontSize}" fill="${cfg.textColor}">${escapeXml(line)}</text>`
        ).join('\n  ');
    }

    const hierarchyTag = position === 'inside'
        ? `<text x="${size/2}" y="${size/2}" text-anchor="middle" dominant-baseline="middle" font-family="${fontFamily}" font-weight="bold" font-size="${80*scale}" fill="${cfg.textColor}">${escapeXml(cfg.hierarchy)}</text>`
        : `<text x="${size/2}" y="80" text-anchor="middle" font-family="${fontFamily}" font-weight="bold" font-size="${35.2*scale}" fill="${cfg.textColor}">${escapeXml(cfg.hierarchy)}</text>`;

    const insideTags = [];
    const outsideTags = [];
    if (position === 'inside') { insideTags.push(hierarchyTag); } else { outsideTags.push(hierarchyTag); }
    if (labelPosition === 'outside') { outsideTags.push(labelTags); } else { insideTags.push(labelTags); }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <defs>${clipTag}</defs>
  ${fillShapeTag}
  <g clip-path="url(#clip)">
  ${assetTag}
  ${insideTags.join('\n  ')}
  </g>
  ${outsideTags.join('\n  ')}
  ${borderShapeTag}
</svg>`;
}

function escapeXml(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseSvgViewBox(root, fallbackW, fallbackH) {
    const vbAttr = root.getAttribute('viewBox');
    if (vbAttr) {
        const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts.every(n => !isNaN(n))) {
            return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
        }
    }
    const w = parseFloat(root.getAttribute('width')) || fallbackW || 100;
    const h = parseFloat(root.getAttribute('height')) || fallbackH || 100;
    return { minX: 0, minY: 0, width: w, height: h };
}

function sanitizeSvgAssetNode(root) {
    root.querySelectorAll('script').forEach(node => node.remove());
    const all = root.querySelectorAll('*');
    all.forEach(node => {
        Array.from(node.attributes).forEach(attr => {
            if (/^on/i.test(attr.name)) {
                node.removeAttribute(attr.name);
            }
        });
    });
    return root;
}

function buildInlineSvgAssetMarkup(rawSvgText, natW, natH, boxX, boxY, boxW, boxH, zoom, offXPercent, offYPercent, opacity) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(rawSvgText, "image/svg+xml");
        const root = doc.documentElement;
        if (!root || root.nodeName.toLowerCase() !== 'svg') return "";

        sanitizeSvgAssetNode(root);

        const vb = parseSvgViewBox(root, natW, natH);
        const geo = getCoverGeometry(natW || vb.width, natH || vb.height, boxW, boxH, zoom, offXPercent, offYPercent);
        const sx = geo.width / (vb.width || natW || 1);
        const sy = geo.height / (vb.height || natH || 1);
        const tx = boxX + geo.x;
        const ty = boxY + geo.y;

        const serializer = new XMLSerializer();
        const inner = Array.from(root.childNodes).map(node => serializer.serializeToString(node)).join('');

        return `<g opacity="${opacity}">
    <g transform="translate(${tx},${ty}) scale(${sx},${sy}) translate(${-vb.minX},${-vb.minY})">
      ${inner}
    </g>
  </g>`;
    } catch (err) {
        return "";
    }
}

function removeUnitWord(str) {
    return (str || "").replace(/\bunit\b/gi, " ");
}

function sanitizeFileNameSegment(str) {
    return (str || "")
        .replace(/[\/\\:*?"<>|]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^\p{L}\p{N}\p{M}_\-]/gu, "")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function buildFileNameFromParts(hierarchySymbol, numberText, index = null, prefix = "") {
    const hierarchyWord = HIERARCHY_NAME_MAP[hierarchySymbol] || "";
    const nameSeg = sanitizeFileNameSegment(removeUnitWord(numberText));
    const idxPart = index !== null ? String(index).padStart(2, '0') : "";
    const parts = [prefix, idxPart, hierarchyWord, nameSeg].filter(Boolean);
    return parts.join("_") || "export";
}

function downloadToken() {
    const cfg = buildDesignerConfig();
    const fileBaseName = buildFileNameFromParts(cfg.hierarchy, cfg.number);

    if (selectedFormat === 'svg') {
        const svgStr = buildUnitSvgString(cfg);
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `${fileBaseName}.svg`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    } else {
        renderUnitToCanvas(cfg, (dataUrl) => {
            const link = document.createElement('a');
            link.download = `${fileBaseName}.png`;
            link.href = dataUrl;
            link.click();
        });
    }
}
