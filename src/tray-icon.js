"use strict";

const TRAY_ICON_SIZE = 32;

const STATUS_RGB = Object.freeze({
    idle: [117, 129, 149],
    running: [43, 196, 232],
    completed: [80, 216, 144],
    needs_input: [255, 200, 87],
    error: [255, 93, 115]
});

function createTrayBitmap(state, size = TRAY_ICON_SIZE)
{
    const bitmap = Buffer.alloc(size * size * 4);
    const center = (size - 1) / 2;
    const outerRadius = size * 0.43;
    const innerRadius = size * 0.25;
    const color = STATUS_RGB[state] || STATUS_RGB.idle;

    for (let y = 0; y < size; y++)
    {
        for (let x = 0; x < size; x++)
        {
            const distance = Math.hypot(x - center, y - center);
            const offset = (y * size + x) * 4;
            let red = 23;
            let green = 32;
            let blue = 51;
            let alpha = 0;

            if (distance <= outerRadius)
            {
                alpha = 255;
                if (distance >= outerRadius - 1.7)
                {
                    red = 255;
                    green = 255;
                    blue = 255;
                }
                else if (distance <= innerRadius)
                {
                    [red, green, blue] = color;
                }
            }

            bitmap[offset] = blue;
            bitmap[offset + 1] = green;
            bitmap[offset + 2] = red;
            bitmap[offset + 3] = alpha;
        }
    }

    return bitmap;
}

module.exports = {
    STATUS_RGB,
    TRAY_ICON_SIZE,
    createTrayBitmap
};
