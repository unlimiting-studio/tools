// 프로필 사진 크롭 화면을 띄우는 Activity와 ActivityResultContract.
// registerForActivityResult(ProfileCropContract())로 열고, 잘라낸 이미지는 앱 캐시의 JPEG 파일로 돌려받는다.
package studio.unlimiting.tools

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Rect
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContract
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * @param image 열 사진. content:// 또는 file:// URI
 * @param apiKey 있으면 자동 크롭 위치를 받아온다. [initialCrop]을 주면 쓰지 않는다.
 * @param initialCrop 미리 받아 둔 시작 위치. 둘 다 없으면 가운데 크롭으로 시작한다.
 * @param outputSize 결과 한 변 픽셀. null이면 원본 해상도
 */
data class ProfileCropRequest(
    val image: Uri,
    val apiKey: String? = null,
    val baseUrl: String = ToolsClient.DEFAULT_BASE_URL,
    val initialCrop: CropRect? = null,
    val shape: CropShape = CropShape.CIRCLE,
    val gridMode: GridMode = GridMode.WHILE_INTERACTING,
    /** [CropShape.ROUNDED_SQUARE]의 모서리 반지름(한 변 대비 비율) */
    val cornerRadius: Float = 0.2f,
    val outputSize: Int? = null,
)

data class ProfileCropActivityResult(
    /** 잘라낸 정사각형 JPEG (앱 캐시 디렉터리의 file:// URI) */
    val uri: Uri,
    /** 이미지 크기에 대한 비율 */
    val crop: CropRect,
    /** 원본 픽셀 기준 크롭 영역 (EXIF 회전 적용 후) */
    val pixelRect: Rect,
    /** 자동 크롭 요청이 실패했다면 그 메시지. 사용자는 가운데 크롭에서 직접 맞췄다. */
    val autoCropError: String? = null,
) {
    fun decodeBitmap(): Bitmap = BitmapFactory.decodeFile(requireNotNull(uri.path))
}

/** 취소하면 null을 돌려준다. */
class ProfileCropContract : ActivityResultContract<ProfileCropRequest, ProfileCropActivityResult?>() {
    override fun createIntent(context: Context, input: ProfileCropRequest): Intent =
        Intent(context, ProfileCropActivity::class.java)
            .setData(input.image)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .putExtra(EXTRA_API_KEY, input.apiKey)
            .putExtra(EXTRA_BASE_URL, input.baseUrl)
            .putExtra(EXTRA_SHAPE, input.shape.name)
            .putExtra(EXTRA_GRID, input.gridMode.name)
            .putExtra(EXTRA_CORNER, input.cornerRadius)
            .putExtra(EXTRA_SIZE, input.outputSize ?: 0)
            .apply { input.initialCrop?.let { putExtra(EXTRA_CROP, it.toArray()) } }

    override fun parseResult(resultCode: Int, intent: Intent?): ProfileCropActivityResult? {
        if (resultCode != Activity.RESULT_OK || intent?.data == null) return null
        val crop = intent.getDoubleArrayExtra(EXTRA_CROP)?.toCropRect() ?: return null
        val r = intent.getIntArrayExtra(EXTRA_PIXEL_RECT) ?: return null
        return ProfileCropActivityResult(
            uri = intent.data!!,
            crop = crop,
            pixelRect = Rect(r[0], r[1], r[2], r[3]),
            autoCropError = intent.getStringExtra(EXTRA_ERROR),
        )
    }

    internal companion object {
        const val EXTRA_API_KEY = "studio.unlimiting.tools.API_KEY"
        const val EXTRA_BASE_URL = "studio.unlimiting.tools.BASE_URL"
        const val EXTRA_SHAPE = "studio.unlimiting.tools.SHAPE"
        const val EXTRA_GRID = "studio.unlimiting.tools.GRID"
        const val EXTRA_CORNER = "studio.unlimiting.tools.CORNER"
        const val EXTRA_SIZE = "studio.unlimiting.tools.SIZE"
        const val EXTRA_CROP = "studio.unlimiting.tools.CROP"
        const val EXTRA_PIXEL_RECT = "studio.unlimiting.tools.PIXEL_RECT"
        const val EXTRA_ERROR = "studio.unlimiting.tools.ERROR"

        fun CropRect.toArray() = doubleArrayOf(left, top, width, height)
        fun DoubleArray.toCropRect() = CropRect(this[0], this[1], this[2], this[3])
    }
}

/**
 * [ProfileCropContract]가 여는 화면. 아래쪽에 취소·자동·완료 버튼이 있다.
 * 버튼 문구는 앱에서 같은 이름의 문자열 리소스로 덮어쓸 수 있다.
 */
class ProfileCropActivity : ComponentActivity() {
    private val scope = MainScope()
    private lateinit var cropView: ProfileCropView
    private var autoCropError: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val extras = intent
        cropView = ProfileCropView(this).apply {
            shape = runCatching { CropShape.valueOf(extras.getStringExtra(ProfileCropContract.EXTRA_SHAPE)!!) }.getOrDefault(CropShape.CIRCLE)
            gridMode = runCatching { GridMode.valueOf(extras.getStringExtra(ProfileCropContract.EXTRA_GRID)!!) }.getOrDefault(GridMode.WHILE_INTERACTING)
            cornerRadius = extras.getFloatExtra(ProfileCropContract.EXTRA_CORNER, 0.2f)
            onAutoCropError = { autoCropError = it.message ?: it.toString() }
        }
        val done = button(R.string.unlimiting_tools_crop_done) { finishWithResult() }.apply { isEnabled = false }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.BLACK)
            addView(button(R.string.unlimiting_tools_crop_cancel) { setResult(RESULT_CANCELED); finish() }, weight())
            addView(button(R.string.unlimiting_tools_crop_reset) { cropView.resetToAuto() }, weight())
            addView(done, weight())
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
            addView(cropView, LinearLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(bar, LinearLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
            // 앱이 edge-to-edge를 쓰면 상태바·내비게이션 바만큼 비운다.
            setOnApplyWindowInsetsListener { v, insets ->
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
                insets
            }
        }
        setContentView(root)

        val uri = intent.data ?: return finish()
        scope.launch {
            val bitmap = runCatching {
                withContext(Dispatchers.IO) {
                    val bytes = contentResolver.openInputStream(uri)!!.use { it.readBytes() }
                    ToolsClient.decodeOriented(bytes)
                }
            }.getOrElse { setResult(RESULT_CANCELED); finish(); return@launch }

            val initial = intent.getDoubleArrayExtra(ProfileCropContract.EXTRA_CROP)
            val apiKey = intent.getStringExtra(ProfileCropContract.EXTRA_API_KEY)
            if (initial != null || apiKey == null) {
                cropView.setImage(bitmap, initial?.let { CropRect(it[0], it[1], it[2], it[3]) })
            } else {
                val baseUrl = intent.getStringExtra(ProfileCropContract.EXTRA_BASE_URL) ?: ToolsClient.DEFAULT_BASE_URL
                cropView.setImage(bitmap, ToolsClient(this@ProfileCropActivity, apiKey, baseUrl))
            }
            done.isEnabled = true
        }
    }

    private fun finishWithResult() {
        val size = intent.getIntExtra(ProfileCropContract.EXTRA_SIZE, 0).takeIf { it > 0 }
        scope.launch {
            val out = cropView.getCroppedImage(size)
            val file = withContext(Dispatchers.IO) {
                val dir = File(cacheDir, "unlimiting-tools").apply { mkdirs() }
                File(dir, "profile-crop-${System.currentTimeMillis()}.jpg").also { f ->
                    f.outputStream().use { out.bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it) }
                }
            }
            val r = out.pixelRect
            setResult(
                RESULT_OK,
                Intent().setData(Uri.fromFile(file))
                    .putExtra(ProfileCropContract.EXTRA_CROP, doubleArrayOf(out.crop.left, out.crop.top, out.crop.width, out.crop.height))
                    .putExtra(ProfileCropContract.EXTRA_PIXEL_RECT, intArrayOf(r.left, r.top, r.right, r.bottom))
                    .putExtra(ProfileCropContract.EXTRA_ERROR, autoCropError),
            )
            finish()
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun button(text: Int, onClick: (View) -> Unit) =
        Button(this, null, android.R.attr.borderlessButtonStyle).apply {
            setText(text)
            setTextColor(Color.WHITE)
            setOnClickListener(onClick)
        }

    private fun weight() = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
}
