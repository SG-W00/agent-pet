"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");
const UPNG = require("upng-js");
const { buildFramePlan, importStickerAnimation } = require("../src/sticker-importer");

function solidFrame(width, height, red, green, blue)
{
    const frame = Buffer.alloc(width * height * 4);
    for (let index = 0; index < width * height; index++)
    {
        frame[(index * 4)] = red;
        frame[(index * 4) + 1] = green;
        frame[(index * 4) + 2] = blue;
        frame[(index * 4) + 3] = 255;
    }
    return frame;
}

function exactArrayBuffer(buffer)
{
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function createAnimatedFixtures(directory)
{
    const width = 8;
    const height = 6;
    const delays = [80, 140];
    const first = solidFrame(width, height, 255, 40, 40);
    const second = solidFrame(width, height, 40, 80, 255);
    const stacked = Buffer.concat([first, second]);
    const gifPath = path.join(directory, "sticker.gif");
    const webpPath = path.join(directory, "sticker.webp");
    const apngPath = path.join(directory, "sticker.png");

    await sharp(stacked, {
        raw: { width, height: height * 2, channels: 4, pageHeight: height }
    }).gif({ delay: delays, loop: 0 }).toFile(gifPath);
    await sharp(stacked, {
        raw: { width, height: height * 2, channels: 4, pageHeight: height }
    }).webp({ delay: delays, loop: 0, lossless: true }).toFile(webpPath);
    fs.writeFileSync(
        apngPath,
        Buffer.from(UPNG.encode(
            [exactArrayBuffer(first), exactArrayBuffer(second)],
            width,
            height,
            0,
            delays
        ))
    );
    return { gifPath, webpPath, apngPath };
}

test("frame sampling keeps total animation duration", () => {
    const delays = Array.from({ length: 96 }, (_value, index) => 20 + (index % 3));
    const plan = buildFramePlan(delays, delays.length, 48);
    assert.equal(plan.length, 48);
    assert.equal(
        plan.reduce((total, frame) => total + frame.duration, 0),
        delays.reduce((total, delay) => total + delay, 0)
    );
});

test("dynamic GIF, APNG and WebP stickers become timed PNG frame sequences", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-pet-sticker-"));
    try
    {
        const fixtures = await createAnimatedFixtures(directory);
        const assetDirectory = path.join(directory, "assets");
        for (const stickerPath of Object.values(fixtures))
        {
            const imported = await importStickerAnimation(stickerPath, assetDirectory);
            assert.equal(imported.sourceFrameCount, 2);
            assert.equal(imported.frameCount, 2);
            assert.equal(imported.frameDurations.length, 2);
            assert.ok(imported.frameDurations.every((duration) => 20 <= duration));
            assert.ok(imported.framePaths.every((framePath) => fs.existsSync(framePath)));

            const metadata = await sharp(imported.framePaths[0]).metadata();
            assert.notDeepEqual(
                fs.readFileSync(imported.framePaths[0]),
                fs.readFileSync(imported.framePaths[1])
            );
            assert.equal(metadata.format, "png");
            assert.equal(metadata.width, metadata.height);

            const cached = await importStickerAnimation(stickerPath, assetDirectory);
            assert.deepEqual(cached.framePaths, imported.framePaths);
        }

        const staticPath = path.join(directory, "static.png");
        await sharp({
            create: {
                width: 8,
                height: 8,
                channels: 4,
                background: { r: 20, g: 40, b: 60, alpha: 1 }
            }
        }).png().toFile(staticPath);
        await assert.rejects(
            () => importStickerAnimation(staticPath, assetDirectory),
            /不是动态表情/
        );
    }
    finally
    {
        sharp.cache(false);
        await fs.promises.rm(directory, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100
        });
    }
});
