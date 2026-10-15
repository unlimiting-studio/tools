package studio.unlimiting.tools

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class CropMathTest {
    private val frame = Frame(24.0, 100.0, 300.0)
    private val eps = 1e-9

    private fun assertCrop(expected: CropRect, actual: CropRect) {
        assertEquals(expected.left, actual.left, eps)
        assertEquals(expected.top, actual.top, eps)
        assertEquals(expected.width, actual.width, eps)
        assertEquals(expected.height, actual.height, eps)
    }

    @Test fun centerCropLandscape() = assertCrop(CropRect(0.25, 0.0, 0.5, 1.0), CropMath.centerCrop(2000, 1000))

    @Test fun roundTrip() {
        // 1568×950 고양이 사진, 얼굴 쪽 570px 정사각형
        val crop = CropRect(0.52, 0.2, 570.0 / 1568, 0.6)
        val t = CropMath.transformFor(crop, 1568, 950, frame)
        assertEquals(300.0 / 570, t.scale, eps)
        assertCrop(crop, CropMath.cropFor(t, 1568, 950, frame))
    }

    @Test fun cropLargerThanImageIsCoverScale() {
        val t = CropMath.transformFor(CropRect(0.0, 0.0, 1.0, 2.0), 2000, 1000, frame)
        assertEquals(CropMath.coverScale(frame, 2000, 1000), t.scale, eps)
    }

    @Test fun cropOutsideImageIsPulledIn() {
        val c = CropMath.cropFor(CropMath.transformFor(CropRect(0.9, 0.7, 0.25, 0.5), 2000, 1000, frame), 2000, 1000, frame)
        assertCrop(CropRect(0.75, 0.5, 0.25, 0.5), c)
    }

    @Test fun clampKeepsFrameCovered() {
        val s = CropMath.coverScale(frame, 2000, 1000) * 2
        val t = CropMath.clamp(Transform(s, 500.0, -5000.0), 2000, 1000, frame)
        assertEquals(frame.left, t.tx, eps) // 왼쪽 가장자리가 프레임 왼쪽에 붙는다
        assertEquals(frame.top + frame.side - 1000 * s, t.ty, eps) // 아래 가장자리가 프레임 아래에 붙는다
    }

    @Test fun pixelRectStaysInside() {
        assertArrayEquals(intArrayOf(1500, 0, 500), CropMath.pixelRect(CropRect(0.75, 0.0, 0.3, 0.6), 2000, 1000))
    }
}
