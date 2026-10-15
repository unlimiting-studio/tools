// 크롭 비율·화면 변환 계산. Android 타입을 쓰지 않아 JVM 단위 테스트로 검증한다.
package studio.unlimiting.tools

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** 이미지 픽셀 좌표를 화면 좌표로 옮기는 변환. 화면 = 픽셀 × scale + (tx, ty) */
internal data class Transform(val scale: Double, val tx: Double, val ty: Double)

/** 화면에 고정된 정사각형 프레임 */
internal data class Frame(val left: Double, val top: Double, val side: Double)

internal object CropMath {
    /** 이미지가 프레임을 빈틈없이 덮는 최소 배율 */
    fun coverScale(frame: Frame, w: Int, h: Int): Double = frame.side / min(w, h)

    /** 이미지 가운데를 덮는 정사각형 크롭 */
    fun centerCrop(w: Int, h: Int): CropRect {
        val side = min(w, h).toDouble()
        return CropRect((w - side) / 2 / w, (h - side) / 2 / h, side / w, side / h)
    }

    /** 크롭 비율이 프레임에 꼭 맞게 보이는 변환. 이미지 밖으로 나가는 값은 안쪽으로 당긴다. */
    fun transformFor(crop: CropRect, w: Int, h: Int, frame: Frame, maxScale: Double = Double.MAX_VALUE): Transform {
        // 픽셀 기준 정사각형이므로 한 변은 width 비율로 정한다.
        val side = (crop.width * w).coerceIn(1.0, min(w, h).toDouble())
        val scale = (frame.side / side).coerceIn(coverScale(frame, w, h), max(maxScale, coverScale(frame, w, h)))
        val t = Transform(scale, frame.left - crop.left * w * scale, frame.top - crop.top * h * scale)
        return clamp(t, w, h, frame)
    }

    /** 현재 변환에서 프레임 안에 보이는 영역을 크롭 비율로 */
    fun cropFor(t: Transform, w: Int, h: Int, frame: Frame): CropRect {
        val side = frame.side / t.scale
        val left = ((frame.left - t.tx) / t.scale).coerceIn(0.0, max(0.0, w - side))
        val top = ((frame.top - t.ty) / t.scale).coerceIn(0.0, max(0.0, h - side))
        return CropRect(left / w, top / h, min(side, w.toDouble()) / w, min(side, h.toDouble()) / h)
    }

    /** 이미지가 프레임을 덮도록 이동량을 줄인다. 이미 벗어나 있으면 되돌리는 방향으로 움직인다. */
    fun clamp(t: Transform, w: Int, h: Int, frame: Frame): Transform {
        val iw = w * t.scale
        val ih = h * t.scale
        val right = frame.left + frame.side
        val bottom = frame.top + frame.side
        val tx = if (iw <= frame.side) frame.left + (frame.side - iw) / 2 else t.tx.coerceIn(right - iw, frame.left)
        val ty = if (ih <= frame.side) frame.top + (frame.side - ih) / 2 else t.ty.coerceIn(bottom - ih, frame.top)
        return Transform(t.scale, tx, ty)
    }

    /** 크롭 비율을 원본 픽셀 영역 [x, y, side]로. 이미지 밖으로 나가지 않게 줄인다. */
    fun pixelRect(crop: CropRect, w: Int, h: Int): IntArray {
        val x = (crop.left * w).roundToInt().coerceIn(0, w - 1)
        val y = (crop.top * h).roundToInt().coerceIn(0, h - 1)
        val side = max(1, minOf((crop.width * w).roundToInt(), w - x, h - y))
        return intArrayOf(x, y, side)
    }
}
