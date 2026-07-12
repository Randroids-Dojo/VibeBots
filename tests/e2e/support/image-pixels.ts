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
