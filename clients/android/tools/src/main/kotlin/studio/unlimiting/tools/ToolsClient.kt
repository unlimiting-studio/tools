// unlimiting-studio tools Android 클라이언트.
// 이미지를 줄여서 API에 보내고, 받은 크롭 영역으로 원본을 기기에서 자른다.
package studio.unlimiting.tools

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.Rect
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** 이미지 크기에 대한 비율(0~1). 픽셀 기준으로 정사각형이다. */
data class CropRect(val left: Double, val top: Double, val width: Double, val height: Double)

data class ProfileCropRect(
    /** face: 사람·동물 얼굴 기준, subject: 얼굴이 없어 주요 피사체 기준 */
    val mode: String,
    val crop: CropRect,
    val faceProbability: Double,
    val confidence: Double,
)

data class ProfileCropResult(
    val rect: ProfileCropRect,
    /** 잘라낸 정사각형 이미지 (EXIF 회전 적용됨) */
    val bitmap: Bitmap,
    /** 원본 픽셀 기준 크롭 영역 */
    val pixelRect: Rect,
)

class ToolsException(val status: Int, message: String) : Exception(message)

/**
 * @param appId 키에 허용된 앱 ID. [ToolsClient] (Context, String) 생성자는 패키지명을 쓴다.
 */
class ToolsClient(
    private val apiKey: String,
    private val baseUrl: String = DEFAULT_BASE_URL,
    private val appId: String? = null,
) {
    constructor(context: Context, apiKey: String, baseUrl: String = DEFAULT_BASE_URL) :
        this(apiKey, baseUrl, context.packageName)

    /** 크롭 영역만 받는다. */
    suspend fun profileCropRect(bitmap: Bitmap): ProfileCropRect = withContext(Dispatchers.IO) {
        val body = encodeForApi(bitmap)
        val conn = URL("$baseUrl/v1/profile-crop").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.setRequestProperty("Authorization", "Bearer $apiKey")
            conn.setRequestProperty("Content-Type", "image/jpeg")
            appId?.let { conn.setRequestProperty("X-App-Id", it) }
            conn.setFixedLengthStreamingMode(body.size)
            conn.outputStream.use { it.write(body) }

            val status = conn.responseCode
            val text = (if (status in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val message = runCatching { JSONObject(text).getString("error") }.getOrDefault("HTTP $status")
                throw ToolsException(status, message)
            }
            parseRect(JSONObject(text))
        } finally {
            conn.disconnect()
        }
    }

    /**
     * 크롭 영역을 받아 정사각형으로 자른다.
     * @param size 출력 한 변 픽셀. null이면 원본 해상도로 자른다.
     */
    suspend fun profileCrop(bitmap: Bitmap, size: Int? = null): ProfileCropResult {
        val rect = profileCropRect(bitmap)
        return withContext(Dispatchers.Default) {
            val (cropped, pixelRect) = cropBitmap(bitmap, rect.crop, size)
            ProfileCropResult(rect, cropped, pixelRect)
        }
    }

    /** 인코딩된 이미지(JPEG, PNG, WebP 등)를 EXIF 회전을 적용해 자른다. */
    suspend fun profileCrop(bytes: ByteArray, size: Int? = null): ProfileCropResult =
        profileCrop(withContext(Dispatchers.Default) { decodeOriented(bytes) }, size)

    companion object {
        const val DEFAULT_BASE_URL = "https://tools.yechanny.workers.dev"

        // 서버(Jev)는 각 변 256~1568px를 받는다. 비용은 픽셀 수에 비례하므로 긴 변 512px로 보낸다.
        private const val SEND_LONG_SIDE = 512.0
        private const val MIN_SIDE = 256.0

        /** API로 보낼 크기. 긴 변 512px, 짧은 변은 최소 256px. */
        @JvmStatic
        fun sendSize(width: Int, height: Int): Pair<Int, Int> {
            var s = SEND_LONG_SIDE / max(width, height)
            if (min(width, height) * s < MIN_SIDE) s = MIN_SIDE / min(width, height)
            val w = (width * s).roundToInt()
            val h = (height * s).roundToInt()
            if (max(w, h) > 1568) throw ToolsException(400, "가로세로 비율이 너무 극단적인 이미지입니다")
            return w to h
        }

        /** 크롭 비율대로 정사각형을 잘라 원본 픽셀 영역과 함께 돌려준다. */
        internal fun cropBitmap(bitmap: Bitmap, crop: CropRect, size: Int?): Pair<Bitmap, Rect> {
            val (x, y, side) = CropMath.pixelRect(crop, bitmap.width, bitmap.height)
            var cropped = Bitmap.createBitmap(bitmap, x, y, side, side)
            if (size != null && size != side) cropped = Bitmap.createScaledBitmap(cropped, size, size, true)
            return cropped to Rect(x, y, x + side, y + side)
        }

        internal fun encodeForApi(bitmap: Bitmap): ByteArray {
            val (w, h) = sendSize(bitmap.width, bitmap.height)
            val small = Bitmap.createScaledBitmap(bitmap, w, h, true)
            return ByteArrayOutputStream().use { out ->
                small.compress(Bitmap.CompressFormat.JPEG, 85, out)
                if (small !== bitmap) small.recycle()
                out.toByteArray()
            }
        }

        /** EXIF 회전을 적용해 디코딩한다 (서버는 회전 정보를 보지 않는다). */
        @JvmStatic
        fun decodeOriented(bytes: ByteArray): Bitmap {
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                ?: throw ToolsException(0, "이미지를 읽지 못했습니다")
            val exif = runCatching { ExifInterface(ByteArrayInputStream(bytes)) }.getOrNull() ?: return bitmap
            val matrix = Matrix()
            when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
                ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
                ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
                ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
                else -> return bitmap
            }
            return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        }

        private fun parseRect(o: JSONObject): ProfileCropRect {
            val c = o.getJSONObject("crop")
            return ProfileCropRect(
                mode = o.getString("mode"),
                crop = CropRect(c.getDouble("left"), c.getDouble("top"), c.getDouble("width"), c.getDouble("height")),
                faceProbability = o.getDouble("faceProbability"),
                confidence = o.getDouble("confidence"),
            )
        }
    }
}
