package studio.unlimiting.tools

import org.junit.Assert.assertEquals
import org.junit.Test

class SendSizeTest {
    @Test fun landscape() = assertEquals(512 to 341, ToolsClient.sendSize(1600, 1067))
    @Test fun portrait() = assertEquals(341 to 512, ToolsClient.sendSize(3000, 4500))
    @Test fun wideKeepsShortSide256() = assertEquals(614 to 256, ToolsClient.sendSize(2400, 1000))
}
