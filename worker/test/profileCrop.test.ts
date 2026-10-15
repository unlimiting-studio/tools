import { describe, expect, it } from "vitest";
import { imageSize } from "../src/image";
import { squareCrop } from "../src/tools/profileCrop";

describe("squareCrop", () => {
  it("얼굴: 박스 중심을 지키는 정사각형", () => {
    const c = squareCrop(1000, 500, { left: 0.45, right: 0.55, top: 0.4, bottom: 0.6 }, 2, 0.15);
    expect(c.width * 1000).toBeCloseTo(c.height * 500, 0); // 픽셀 기준 정사각형
    expect(c.left + c.width / 2).toBeCloseTo(0.5, 3);
    expect(c.top + c.height / 2).toBeCloseTo(0.5, 3);
  });

  it("얼굴: 가장자리에 붙으면 중심을 한 변의 15%까지 옮기고, 그래도 넘치면 작아진다", () => {
    const c = squareCrop(1000, 1000, { left: 0.9, right: 0.98, top: 0.4, bottom: 0.5 }, 3, 0.15);
    expect(c.left + c.width).toBeCloseTo(1, 3);
    // 중심 0.94까지 거리 0.06 = side × (0.5 − 0.15)
    expect(c.width).toBeCloseTo(0.06 / 0.35, 3);
    expect(0.94 - (c.left + c.width / 2)).toBeCloseTo(c.width * 0.15, 3);
  });

  it("얼굴: 조금만 넘치면 크기를 지키고 민다", () => {
    const c = squareCrop(1000, 1000, { left: 0.8, right: 0.9, top: 0.45, bottom: 0.55 }, 4, 0.15);
    expect(c.width).toBeCloseTo(0.4, 3);
    expect(c.left).toBeCloseTo(0.6, 3);
  });

  it("maxOffset 0이면 중심을 지킨다", () => {
    const c = squareCrop(1000, 1000, { left: 0.9, right: 0.98, top: 0.4, bottom: 0.5 }, 3, 0);
    expect(c.left + c.width / 2).toBeCloseTo(0.94, 3);
  });

  it("피사체: 크기를 지키고 이미지 안으로 민다", () => {
    const c = squareCrop(1600, 1000, { left: 0.9, right: 1, top: 0, bottom: 0.2 }, 1.15, 0.5);
    expect(c.left + c.width).toBeCloseTo(1, 3);
    expect(c.top).toBe(0);
  });
});

describe("imageSize", () => {
  it("PNG", () => {
    const b = new Uint8Array(24);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(b.buffer).setUint32(16, 640);
    new DataView(b.buffer).setUint32(20, 480);
    expect(imageSize(b)).toEqual({ width: 640, height: 480 });
  });

  it("JPEG (APP0 뒤 SOF0)", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0]);
    expect(imageSize(b)).toEqual({ width: 640, height: 480 });
  });

  it("알 수 없는 형식", () => {
    expect(imageSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
