"use strict";

const DEFAULT_OPTIONS = Object.freeze({
    backgroundDistance: 58,
    cornerSimilarity: 48,
    textureThreshold: 42,
    textureRadius: 8,
    paddingRatio: 0.035,
    maxPixels: 16 * 1024 * 1024
});

function colorDistance(left, right)
{
    const blue = left[0] - right[0];
    const green = left[1] - right[1];
    const red = left[2] - right[2];
    return Math.sqrt((blue * blue) + (green * green) + (red * red));
}

function pixelAt(bitmap, width, x, y)
{
    const offset = ((y * width) + x) * 4;
    return [bitmap[offset], bitmap[offset + 1], bitmap[offset + 2], bitmap[offset + 3]];
}

function averagePatch(bitmap, width, height, startX, startY, patchSize)
{
    const totals = [0, 0, 0];
    let count = 0;
    for (let y = startY; y < Math.min(height, startY + patchSize); y++)
    {
        for (let x = startX; x < Math.min(width, startX + patchSize); x++)
        {
            const pixel = pixelAt(bitmap, width, x, y);
            if (16 < pixel[3])
            {
                totals[0] += pixel[0];
                totals[1] += pixel[1];
                totals[2] += pixel[2];
                count++;
            }
        }
    }
    return 0 === count ? null : totals.map((value) => value / count);
}

function detectBackgroundColors(bitmap, width, height)
{
    const shortestSide = Math.min(width, height);
    const patchSize = Math.max(1, Math.min(8, Math.floor(shortestSide / 12)));
    const inset = 2 < shortestSide
        ? Math.max(1, Math.min(12, Math.floor(shortestSide / 100)))
        : 0;
    return [
        averagePatch(bitmap, width, height, inset, inset, patchSize),
        averagePatch(bitmap, width, height, width - inset - patchSize, inset, patchSize),
        averagePatch(bitmap, width, height, inset, height - inset - patchSize, patchSize),
        averagePatch(bitmap, width, height, width - inset - patchSize, height - inset - patchSize, patchSize),
        pixelAt(bitmap, width, 0, 0),
        pixelAt(bitmap, width, width - 1, 0),
        pixelAt(bitmap, width, 0, height - 1),
        pixelAt(bitmap, width, width - 1, height - 1)
    ].filter(Boolean);
}

function detectBackgroundColor(bitmap, width, height, cornerSimilarity)
{
    const corners = detectBackgroundColors(bitmap, width, height);
    let bestCluster = [];
    for (const candidate of corners)
    {
        const cluster = corners.filter((color) => colorDistance(candidate, color) <= cornerSimilarity);
        if (cluster.length > bestCluster.length)
        {
            bestCluster = cluster;
        }
    }
    if (3 > bestCluster.length)
    {
        return null;
    }
    return [0, 1, 2].map((channel) => (
        bestCluster.reduce((total, color) => total + color[channel], 0) / bestCluster.length
    ));
}

function extractForegroundBitmap(bitmap, width, height, options = {})
{
    const settings = { ...DEFAULT_OPTIONS, ...options };
    if (!Buffer.isBuffer(bitmap) || 1 > width || 1 > height || bitmap.length !== width * height * 4)
    {
        throw new Error("图片像素数据无效");
    }
    if (settings.maxPixels < width * height)
    {
        return { bitmap: Buffer.from(bitmap), bounds: { x: 0, y: 0, width, height }, changed: false };
    }

    const output = Buffer.from(bitmap);
    const visited = new Uint8Array(width * height);
    const classified = new Uint8Array(width * height);
    const queue = new Uint32Array(width * height);
    const backgrounds = detectBackgroundColors(bitmap, width, height);
    let queueStart = 0;
    let queueEnd = 0;

    function localVariation(index)
    {
        const x = index % width;
        const y = Math.floor(index / width);
        const color = pixelAt(bitmap, width, x, y);
        const radius = settings.textureRadius;
        const neighbors = [
            [Math.max(0, x - radius), y],
            [Math.min(width - 1, x + radius), y],
            [x, Math.max(0, y - radius)],
            [x, Math.min(height - 1, y + radius)],
            [Math.max(0, x - radius), Math.max(0, y - radius)],
            [Math.min(width - 1, x + radius), Math.max(0, y - radius)],
            [Math.max(0, x - radius), Math.min(height - 1, y + radius)],
            [Math.min(width - 1, x + radius), Math.min(height - 1, y + radius)]
        ];
        let variation = 0;
        for (const [neighborX, neighborY] of neighbors)
        {
            variation = Math.max(
                variation,
                colorDistance(color, pixelAt(bitmap, width, neighborX, neighborY))
            );
        }
        return variation;
    }

    function isBackground(index)
    {
        if (0 !== classified[index])
        {
            return 1 === classified[index];
        }
        const offset = index * 4;
        if (16 >= bitmap[offset + 3])
        {
            classified[index] = 1;
            return true;
        }
        const color = [bitmap[offset], bitmap[offset + 1], bitmap[offset + 2]];
        const colorMatches = backgrounds.some((background) => (
            colorDistance(color, background) <= settings.backgroundDistance
        ));
        const protectTexture = 64 <= Math.min(width, height);
        const background = colorMatches
            && (!protectTexture || localVariation(index) <= settings.textureThreshold);
        classified[index] = background ? 1 : 2;
        return background;
    }

    function enqueue(index)
    {
        if (0 === visited[index] && isBackground(index))
        {
            visited[index] = 1;
            queue[queueEnd++] = index;
        }
    }

    const inset = 2 < Math.min(width, height)
        ? Math.max(1, Math.min(12, Math.floor(Math.min(width, height) / 100)))
        : 0;
    const seedPoints = [
        [0, 0],
        [width - 1, 0],
        [0, height - 1],
        [width - 1, height - 1],
        [inset, inset],
        [width - inset - 1, inset],
        [inset, height - inset - 1],
        [width - inset - 1, height - inset - 1]
    ];
    for (const [seedX, seedY] of seedPoints)
    {
        enqueue((seedY * width) + seedX);
    }

    while (queueStart < queueEnd)
    {
        const index = queue[queueStart++];
        const x = index % width;
        const y = Math.floor(index / width);
        output[(index * 4) + 3] = 0;
        if (0 < x) enqueue(index - 1);
        if (x + 1 < width) enqueue(index + 1);
        if (0 < y) enqueue(index - width);
        if (y + 1 < height) enqueue(index + width);
    }

    const rowCounts = new Uint32Array(height);
    const columnCounts = new Uint32Array(width);
    let opaquePixels = 0;
    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            if (16 < output[(((y * width) + x) * 4) + 3])
            {
                rowCounts[y]++;
                columnCounts[x]++;
                opaquePixels++;
            }
        }
    }
    if (0 === opaquePixels)
    {
        return { bitmap: Buffer.from(bitmap), bounds: { x: 0, y: 0, width, height }, changed: false };
    }

    const minimumRowPixels = Math.max(2, Math.round(width * 0.003));
    const minimumColumnPixels = Math.max(2, Math.round(height * 0.003));
    const minX = columnCounts.findIndex((count) => minimumColumnPixels <= count);
    const minY = rowCounts.findIndex((count) => minimumRowPixels <= count);
    let maxX = width - 1;
    let maxY = height - 1;
    while (minX < maxX && minimumColumnPixels > columnCounts[maxX])
    {
        maxX--;
    }
    while (minY < maxY && minimumRowPixels > rowCounts[maxY])
    {
        maxY--;
    }

    const padding = Math.max(2, Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * settings.paddingRatio));
    const bounds = {
        x: Math.max(0, minX - padding),
        y: Math.max(0, minY - padding),
        width: 0,
        height: 0
    };
    bounds.width = Math.min(width - bounds.x, (maxX - minX + 1) + (padding * 2));
    bounds.height = Math.min(height - bounds.y, (maxY - minY + 1) + (padding * 2));
    const cropped = 0 < bounds.x || 0 < bounds.y || bounds.width < width || bounds.height < height;
    return { bitmap: output, bounds, changed: 0 < queueEnd || cropped };
}

module.exports = {
    DEFAULT_OPTIONS,
    detectBackgroundColor,
    detectBackgroundColors,
    extractForegroundBitmap
};
