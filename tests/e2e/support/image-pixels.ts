import type { Page } from "@playwright/test";

export async function imagePixelDifferenceRatio(
  page: Page,
  before: Buffer,
  after: Buffer,
): Promise<number> {
  return page.evaluate(
    async ([beforeBase64, afterBase64]) => {
      const decode = async (encoded: string) => {
        const response = await fetch(`data:image/png;base64,${encoded}`);
        return createImageBitmap(await response.blob());
      };
      const [beforeImage, afterImage] = await Promise.all([
        decode(beforeBase64),
        decode(afterBase64),
      ]);
      if (
        beforeImage.width !== afterImage.width ||
        beforeImage.height !== afterImage.height
      ) {
        beforeImage.close();
        afterImage.close();
        return 1;
      }
      const canvas = document.createElement("canvas");
      canvas.width = beforeImage.width;
      canvas.height = beforeImage.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        beforeImage.close();
        afterImage.close();
        return 1;
      }
      context.drawImage(beforeImage, 0, 0);
      const beforePixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(afterImage, 0, 0);
      const afterPixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      beforeImage.close();
      afterImage.close();
      let changed = 0;
      for (let i = 0; i < beforePixels.length; i += 4) {
        if (
          Math.abs(beforePixels[i] - afterPixels[i]) > 12 ||
          Math.abs(beforePixels[i + 1] - afterPixels[i + 1]) > 12 ||
          Math.abs(beforePixels[i + 2] - afterPixels[i + 2]) > 12
        ) {
          changed += 1;
        }
      }
      return changed / (canvas.width * canvas.height);
    },
    [before.toString("base64"), after.toString("base64")],
  );
}

export async function imageRegionPixelDifferenceRatio(
  page: Page,
  before: Buffer,
  after: Buffer,
  bounds: { left: number; top: number; right: number; bottom: number },
): Promise<number> {
  return page.evaluate(
    async ([beforeBase64, afterBase64, bounds]) => {
      const decode = async (encoded: string) => {
        const response = await fetch(`data:image/png;base64,${encoded}`);
        return createImageBitmap(await response.blob());
      };
      const [beforeImage, afterImage] = await Promise.all([
        decode(beforeBase64 as string),
        decode(afterBase64 as string),
      ]);
      if (
        beforeImage.width !== afterImage.width ||
        beforeImage.height !== afterImage.height
      ) {
        beforeImage.close();
        afterImage.close();
        return 1;
      }
      const canvas = document.createElement("canvas");
      canvas.width = beforeImage.width;
      canvas.height = beforeImage.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        beforeImage.close();
        afterImage.close();
        return 1;
      }
      const region = bounds as {
        left: number;
        top: number;
        right: number;
        bottom: number;
      };
      const left = Math.floor(canvas.width * region.left);
      const top = Math.floor(canvas.height * region.top);
      const right = Math.ceil(canvas.width * region.right);
      const bottom = Math.ceil(canvas.height * region.bottom);
      const width = right - left;
      const height = bottom - top;
      context.drawImage(beforeImage, 0, 0);
      const beforePixels = context.getImageData(left, top, width, height).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(afterImage, 0, 0);
      const afterPixels = context.getImageData(left, top, width, height).data;
      beforeImage.close();
      afterImage.close();
      let changed = 0;
      for (let i = 0; i < beforePixels.length; i += 4) {
        if (
          Math.abs(beforePixels[i] - afterPixels[i]) > 12 ||
          Math.abs(beforePixels[i + 1] - afterPixels[i + 1]) > 12 ||
          Math.abs(beforePixels[i + 2] - afterPixels[i + 2]) > 12
        ) {
          changed += 1;
        }
      }
      return changed / (width * height);
    },
    [before.toString("base64"), after.toString("base64"), bounds] as const,
  );
}

export async function imageRegionMaxRgb(
  page: Page,
  image: Buffer,
  bounds: { left: number; top: number; right: number; bottom: number },
): Promise<number> {
  return page.evaluate(
    async ({ encoded, bounds }) => {
      const response = await fetch(`data:image/png;base64,${encoded}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        bitmap.close();
        return 255;
      }
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const left = Math.floor(canvas.width * bounds.left);
      const top = Math.floor(canvas.height * bounds.top);
      const right = Math.ceil(canvas.width * bounds.right);
      const bottom = Math.ceil(canvas.height * bounds.bottom);
      const pixels = context.getImageData(
        left,
        top,
        right - left,
        bottom - top,
      ).data;
      let max = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        max = Math.max(max, pixels[i], pixels[i + 1], pixels[i + 2]);
      }
      return max;
    },
    { encoded: image.toString("base64"), bounds },
  );
}

export async function imageRegionBlueCentroid(
  page: Page,
  image: Buffer,
  bounds: { left: number; top: number; right: number; bottom: number },
): Promise<{ x: number; y: number; pixels: number }> {
  return page.evaluate(
    async ({ encoded, bounds }) => {
      const response = await fetch(`data:image/png;base64,${encoded}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        bitmap.close();
        return { x: 0, y: 0, pixels: 0 };
      }
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const left = Math.floor(canvas.width * bounds.left);
      const top = Math.floor(canvas.height * bounds.top);
      const right = Math.ceil(canvas.width * bounds.right);
      const bottom = Math.ceil(canvas.height * bounds.bottom);
      const width = right - left;
      const height = bottom - top;
      const data = context.getImageData(left, top, width, height).data;
      let xTotal = 0;
      let yTotal = 0;
      let pixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const red = data[i];
        const green = data[i + 1];
        const blue = data[i + 2];
        if (blue <= 55 || blue <= red * 1.15 || green <= 35) continue;
        const pixel = i / 4;
        xTotal += left + (pixel % width);
        yTotal += top + Math.floor(pixel / width);
        pixels += 1;
      }
      return {
        x: pixels > 0 ? xTotal / pixels : 0,
        y: pixels > 0 ? yTotal / pixels : 0,
        pixels,
      };
    },
    { encoded: image.toString("base64"), bounds },
  );
}

export async function imageRegionRgbStats(
  page: Page,
  image: Buffer,
  bounds: { left: number; top: number; right: number; bottom: number },
): Promise<{
  meanRed: number;
  meanGreen: number;
  meanBlue: number;
  nearBlackRatio: number;
}> {
  return page.evaluate(
    async ({ encoded, bounds }) => {
      const response = await fetch(`data:image/png;base64,${encoded}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        bitmap.close();
        return {
          meanRed: 0,
          meanGreen: 0,
          meanBlue: 0,
          nearBlackRatio: 1,
        };
      }
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const left = Math.floor(canvas.width * bounds.left);
      const top = Math.floor(canvas.height * bounds.top);
      const right = Math.ceil(canvas.width * bounds.right);
      const bottom = Math.ceil(canvas.height * bounds.bottom);
      const pixels = context.getImageData(
        left,
        top,
        right - left,
        bottom - top,
      ).data;
      let red = 0;
      let green = 0;
      let blue = 0;
      let nearBlack = 0;
      const count = pixels.length / 4;
      for (let i = 0; i < pixels.length; i += 4) {
        red += pixels[i];
        green += pixels[i + 1];
        blue += pixels[i + 2];
        if (pixels[i] < 16 && pixels[i + 1] < 16 && pixels[i + 2] < 16) {
          nearBlack += 1;
        }
      }
      return {
        meanRed: red / count,
        meanGreen: green / count,
        meanBlue: blue / count,
        nearBlackRatio: nearBlack / count,
      };
    },
    { encoded: image.toString("base64"), bounds },
  );
}

/**
 * Classify a region's pixels into warm (dirt) and neutral (rock) fractions.
 * Dirt blocks render warm brown (red well above blue); rock renders a near
 * gray (the channels cluster). Used to prove the first-person bunker interior
 * renders BOTH dirt and rock, not the single flat gray the node materials
 * produced before per-kind meshes (they ignore instanceColor). Near-black
 * background and bright UI chrome fall into neither bucket.
 */
export async function imageRegionWarmNeutralFractions(
  page: Page,
  image: Buffer,
  bounds: { left: number; top: number; right: number; bottom: number },
): Promise<{ warm: number; neutral: number }> {
  return page.evaluate(
    async ({ encoded, bounds }) => {
      const response = await fetch(`data:image/png;base64,${encoded}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        bitmap.close();
        return { warm: 0, neutral: 0 };
      }
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const left = Math.floor(canvas.width * bounds.left);
      const top = Math.floor(canvas.height * bounds.top);
      const right = Math.ceil(canvas.width * bounds.right);
      const bottom = Math.ceil(canvas.height * bounds.bottom);
      const pixels = context.getImageData(
        left,
        top,
        right - left,
        bottom - top,
      ).data;
      const count = pixels.length / 4;
      let warm = 0;
      let neutral = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const red = pixels[i];
        const green = pixels[i + 1];
        const blue = pixels[i + 2];
        const max = Math.max(red, green, blue);
        // Dirt: distinctly warm and bright enough to read as brown.
        if (red - blue > 24 && red > 48) {
          warm += 1;
          continue;
        }
        // Rock: channels cluster (gray), mid-brightness, not background/UI.
        if (max >= 28 && max <= 210 && max - Math.min(red, green, blue) <= 18) {
          neutral += 1;
        }
      }
      return { warm: warm / count, neutral: neutral / count };
    },
    { encoded: image.toString("base64"), bounds },
  );
}
