package studio.unlimiting.tools

import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * 크롭 화면을 실제로 띄워 시작 위치와 "프레임을 항상 덮는다" 제약을 확인한다. API는 부르지 않는다.
 * 인자를 주면 그 사진으로 원·정사각형 화면을 캡처해 기기에 저장한다.
 *   -Pandroid.testInstrumentationRunnerArguments.image=/data/local/tmp/cat.jpg
 *   -Pandroid.testInstrumentationRunnerArguments.crop=0.52:0.2:0.3635:0.6
 *   -Pandroid.testInstrumentationRunnerArguments.screenshots=true
 * 캡처는 테스트 앱의 외부 파일 디렉터리(Android/data/<패키지>/files/cropper)에 저장된다.
 */
@RunWith(AndroidJUnit4::class)
class ProfileCropActivityTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val args = InstrumentationRegistry.getArguments()

    private fun sampleImage(): Uri {
        args.getString("image")?.let { return Uri.fromFile(File(it)) }
        val bitmap = Bitmap.createBitmap(1600, 1000, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.DKGRAY) }
        val file = File(context.cacheDir, "crop-test.jpg")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        return Uri.fromFile(file)
    }

    private fun initialCrop(): CropRect =
        args.getString("crop")?.split(",", ":")?.map { it.trim().toDouble() }?.let { CropRect(it[0], it[1], it[2], it[3]) }
            ?: CropRect(0.5, 0.2, 0.375, 0.6)

    private fun findCropView(v: View): ProfileCropView? = when (v) {
        is ProfileCropView -> v
        is ViewGroup -> (0 until v.childCount).firstNotNullOfOrNull { findCropView(v.getChildAt(it)) }
        else -> null
    }

    private fun launch(
        shape: CropShape,
        grid: GridMode,
        request: ProfileCropRequest = ProfileCropRequest(image = sampleImage(), initialCrop = initialCrop(), shape = shape, gridMode = grid),
        block: (ProfileCropView) -> Unit,
    ) {
        ActivityScenario.launch<ProfileCropActivity>(ProfileCropContract().createIntent(context, request)).use { scenario ->
            var view: ProfileCropView? = null
            // 디코딩·레이아웃이 끝날 때까지 기다린다.
            val deadline = SystemClock.uptimeMillis() + 10_000
            while (SystemClock.uptimeMillis() < deadline) {
                var ready = false
                scenario.onActivity { view = findCropView(it.window.decorView); ready = view?.isLaidOutWithImage == true }
                if (ready) break
                SystemClock.sleep(100)
            }
            instrumentation.waitForIdleSync()
            block(checkNotNull(view))
        }
    }

    private fun drag(view: View, dx: Float, dy: Float) {
        val x = view.width / 2f
        val y = view.height / 2f
        val t = SystemClock.uptimeMillis()
        fun send(action: Int, px: Float, py: Float, time: Long) = instrumentation.runOnMainSync {
            MotionEvent.obtain(t, time, action, px, py, 0).also { view.dispatchTouchEvent(it); it.recycle() }
        }
        send(MotionEvent.ACTION_DOWN, x, y, t)
        for (i in 1..10) send(MotionEvent.ACTION_MOVE, x + dx * i / 10, y + dy * i / 10, t + i * 16L)
        send(MotionEvent.ACTION_UP, x + dx, y + dy, t + 200)
        instrumentation.waitForIdleSync()
    }

    private fun <T> main(block: () -> T): T {
        var result: T? = null
        instrumentation.runOnMainSync { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun screenshot(name: String) {
        if (args.getString("screenshots") != "true") return
        val dir = File(context.getExternalFilesDir(null), "cropper")
        SystemClock.sleep(300)
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: return
        dir.mkdirs()
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun startsAtInitialCropAndStaysCovered() = launch(CropShape.CIRCLE, GridMode.ALWAYS) { view ->
        val expected = initialCrop()
        val start = checkNotNull(main { view.crop })
        assertEquals(expected.left, start.left, 0.01)
        assertEquals(expected.top, start.top, 0.01)
        assertEquals(expected.width, start.width, 0.01)
        screenshot("circle")

        // 크게 끌어도 프레임은 이미지 안에 있어야 한다.
        drag(view, -5000f, -5000f)
        val moved = checkNotNull(main { view.crop })
        assertNotEquals(start.left, moved.left, 1e-6)
        assertTrue(moved.left >= 0 && moved.top >= 0)
        assertTrue(moved.left + moved.width <= 1 + 1e-6 && moved.top + moved.height <= 1 + 1e-6)

        // 자동(시작) 위치로 되돌리기
        instrumentation.runOnMainSync { view.resetToAuto(animate = false) }
        assertEquals(expected.left, checkNotNull(main { view.crop }).left, 0.01)

        val out = main { view.getCroppedImage(size = 256) }
        assertEquals(256, out.bitmap.width)
        assertEquals(256, out.bitmap.height)
    }

    @Test fun squareShape() = launch(CropShape.SQUARE, GridMode.ALWAYS) { view ->
        assertEquals(initialCrop().left, checkNotNull(main { view.crop }).left, 0.01)
        screenshot("square")
    }

    @Test fun roundedSquareWhileInteracting() = launch(CropShape.ROUNDED_SQUARE, GridMode.WHILE_INTERACTING) { view ->
        assertEquals(initialCrop().left, checkNotNull(main { view.crop }).left, 0.01)
        screenshot("rounded")
    }

    /** 자동 크롭 요청이 실패해도 가운데 크롭으로 편집할 수 있어야 한다. */
    @Test fun apiFailureKeepsCenterCrop() {
        val request = ProfileCropRequest(image = sampleImage(), apiKey = "invalid", baseUrl = "http://127.0.0.1:9")
        launch(CropShape.CIRCLE, GridMode.HIDDEN, request) { view ->
            val deadline = SystemClock.uptimeMillis() + 10_000
            while (main { view.isLoading } && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(100)
            assertTrue(!main { view.isLoading })
            val c = checkNotNull(main { view.crop })
            assertEquals(0.5, c.left + c.width / 2, 0.01)
            assertEquals(0.5, c.top + c.height / 2, 0.01)
        }
    }
}
