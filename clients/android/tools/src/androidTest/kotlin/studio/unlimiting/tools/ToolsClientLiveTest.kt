package studio.unlimiting.tools

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * 실제 API를 호출한다. 인자가 없으면 건너뛴다.
 *   -Pandroid.testInstrumentationRunnerArguments.apiKey=...
 *   -Pandroid.testInstrumentationRunnerArguments.baseUrl=http://10.0.2.2:8787
 *   -Pandroid.testInstrumentationRunnerArguments.image=/data/local/tmp/test.jpg
 */
@RunWith(AndroidJUnit4::class)
class ToolsClientLiveTest {
    @Test fun profileCrop() = runTest {
        val args = InstrumentationRegistry.getArguments()
        val key = args.getString("apiKey")
        val image = args.getString("image")
        assumeTrue(key != null && image != null)
        val client = ToolsClient(
            apiKey = key!!,
            baseUrl = args.getString("baseUrl") ?: ToolsClient.DEFAULT_BASE_URL,
            appId = InstrumentationRegistry.getInstrumentation().targetContext.packageName,
        )
        val result = client.profileCrop(File(image!!).readBytes(), size = 300)
        assertEquals(300, result.bitmap.width)
        assertEquals(300, result.bitmap.height)
        println("live: ${result.rect} ${result.pixelRect}")
    }
}
