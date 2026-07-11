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
